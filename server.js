const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// NOVO: Povezivanje sa bazom preko promenljivih okruženja (Environment Variables)
// Ako je sajt na internetu, čitaće prave podatke, a kod tebe na računaru čitaće 'localhost'
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'radno_vreme',
    port: process.env.DB_PORT || 3306
});

db.connect((err) => {
    if (err) console.error('Greška pri povezivanju sa bazom:', err);
    else console.log('Povezano sa bazom podataka.');
});

// Zaposleni - CRUD operacije
app.get('/zaposleni', (req, res) => {
  db.query('SELECT * FROM zaposleni', (err, rezultati) => {
    if (err) return res.status(500).send('Greška');
    res.json(rezultati);
  });
});

app.post('/zaposleni', (req, res) => {
  const { ime, prezime, pozicija, satnica, nocna_pocetak, nocna_kraj, nocni_bonus, praznik_bonus, go_procenat, bolovanje_procenat } = req.body;
  const sql = 'INSERT INTO zaposleni (ime, prezime, pozicija, satnica, nocna_pocetak, nocna_kraj, nocni_bonus, praznik_bonus, go_procenat, bolovanje_procenat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const vrednosti = [ime, prezime, pozicija, satnica || 0, nocna_pocetak || '22:00', nocna_kraj || '06:00', nocni_bonus || 0, praznik_bonus || 0, go_procenat || 100, bolovanje_procenat || 65];
  
  db.query(sql, vrednosti, (err) => {
    if (err) return res.status(500).send('Greška');
    res.status(201).json({ poruka: 'Zaposleni uspešno dodat' });
  });
});

app.put('/zaposleni/:id', (req, res) => {
  const { ime, prezime, pozicija, satnica, nocna_pocetak, nocna_kraj, nocni_bonus, praznik_bonus, go_procenat, bolovanje_procenat } = req.body;
  const sql = 'UPDATE zaposleni SET ime=?, prezime=?, pozicija=?, satnica=?, nocna_pocetak=?, nocna_kraj=?, nocni_bonus=?, praznik_bonus=?, go_procenat=?, bolovanje_procenat=? WHERE id=?';
  const vrednosti = [ime, prezime, pozicija, satnica || 0, nocna_pocetak || '22:00', nocna_kraj || '06:00', nocni_bonus || 0, praznik_bonus || 0, go_procenat || 100, bolovanje_procenat || 65, req.params.id];
  
  db.query(sql, vrednosti, (err) => {
    if (err) return res.status(500).send('Greška');
    res.send('Podaci izmenjeni');
  });
});

app.delete('/zaposleni/:id', (req, res) => {
  db.query('DELETE FROM zaposleni WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).send('Greška');
    res.send('Obrisan');
  });
});

// Evidencija (Clock in/out)
app.post('/evidencija/dolazak', (req, res) => {
  db.query('INSERT INTO evidencija (zaposleni_id, vreme_dolaska) VALUES (?, NOW())', [req.body.zaposleni_id], (err) => {
    if (err) return res.status(500).send('Greška');
    res.send('Dolazak evidentiran');
  });
});

app.put('/evidencija/odlazak', (req, res) => {
  db.query('UPDATE evidencija SET vreme_odlaska = NOW() WHERE zaposleni_id = ? AND vreme_odlaska IS NULL', [req.body.zaposleni_id], (err) => {
    if (err) return res.status(500).send('Greška');
    res.send('Odlazak evidentiran');
  });
});

// Nedeljni planer
app.get('/raspored', (req, res) => {
  db.query('SELECT * FROM raspored', (err, rezultati) => {
    if (err) return res.status(500).send('Greška');
    res.json(rezultati);
  });
});

app.post('/raspored', (req, res) => {
  const { zaposleni_id, dan, pocetak, kraj } = req.body;
  db.query('DELETE FROM raspored WHERE zaposleni_id = ? AND dan = ?', [zaposleni_id, dan], () => {
    if (!pocetak && !kraj) return res.send('Uklonjeno');
    db.query('INSERT INTO raspored (zaposleni_id, dan, pocetak, kraj) VALUES (?, ?, ?, ?)', [zaposleni_id, dan, pocetak, kraj], (err) => {
      if (err) return res.status(500).send('Greška');
      res.send('Sačuvano');
    });
  });
});

// Odsustva (GO i Bolovanje)
app.get('/odsustva', (req, res) => {
  db.query('SELECT * FROM odsustva', (err, rezultati) => {
    if (err) return res.status(500).send('Greška');
    res.json(rezultati);
  });
});

app.post('/odsustva', (req, res) => {
  const { zaposleni_id, datum_od, datum_do, tip } = req.body;
  db.query('INSERT INTO odsustva (zaposleni_id, datum_od, datum_do, tip) VALUES (?, ?, ?, ?)', [zaposleni_id, datum_od, datum_do, tip], (err) => {
    if (err) return res.status(500).send('Greška');
    res.send('Odsustvo sačuvano');
  });
});

app.delete('/odsustva/:id', (req, res) => {
  db.query('DELETE FROM odsustva WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).send('Greška');
    res.send('Odsustvo obrisano');
  });
});

// Obračun zarada
const drzavniPraznici = ['01-01', '01-02', '01-07', '02-15', '02-16', '05-01', '05-02', '11-11'];

app.get('/izvestaj/:id', (req, res) => {
  const zaposleniId = req.params.id;
  const mesec = req.query.mesec ? parseInt(req.query.mesec) : new Date().getMonth() + 1;
  const godina = req.query.godina ? parseInt(req.query.godina) : new Date().getFullYear();

  db.query('SELECT * FROM zaposleni WHERE id = ?', [zaposleniId], (err, radnici) => {
    if (err || radnici.length === 0) return res.status(404).send('Zaposleni nije pronađen');
    const radnik = radnici[0];

    db.query('SELECT * FROM evidencija WHERE zaposleni_id = ? AND vreme_odlaska IS NOT NULL', [zaposleniId], (err, smene) => {
      let ukupnoSati = 0;
      let praznicniSati = 0;
      let nocniSati = 0;

      smene.forEach(smena => {
        const dolazak = new Date(smena.vreme_dolaska);
        if (dolazak.getMonth() + 1 === mesec && dolazak.getFullYear() === godina) {
          const odlazak = new Date(smena.vreme_odlaska);
          const sati = (odlazak - dolazak) / (1000 * 60 * 60);
          ukupnoSati += sati;

          const formatiranDatum = `${String(dolazak.getMonth() + 1).padStart(2, '0')}-${String(dolazak.getDate()).padStart(2, '0')}`;
          if (drzavniPraznici.includes(formatiranDatum)) praznicniSati += sati;

          const satDolaska = dolazak.getHours();
          const pocetakNocne = radnik.nocna_pocetak ? parseInt(radnik.nocna_pocetak.split(':')[0]) : 22; 
          const krajNocne = radnik.nocna_kraj ? parseInt(radnik.nocna_kraj.split(':')[0]) : 6;
          if (satDolaska >= pocetakNocne || satDolaska < krajNocne) nocniSati += sati;
        }
      });

      db.query('SELECT * FROM odsustva WHERE zaposleni_id = ?', [zaposleniId], (err, odsustva) => {
        let satiGO = 0;
        let satiBolovanje = 0;

        odsustva.forEach(odsustvo => {
          const start = new Date(odsustvo.datum_od);
          const end = new Date(odsustvo.datum_do);
          
          let trenutni = new Date(start.getTime());
          while (trenutni <= end) {
            if (trenutni.getMonth() + 1 === mesec && trenutni.getFullYear() === godina) {
              const danUNedelji = trenutni.getDay();
              if (danUNedelji >= 1 && danUNedelji <= 5) {
                if (odsustvo.tip === 'GO') satiGO += 8;
                else if (odsustvo.tip === 'BOLOVANJE') satiBolovanje += 8;
              }
            }
            trenutni.setDate(trenutni.getDate() + 1);
          }
        });

        const osnovnaSatnica = parseFloat(radnik.satnica) || 0;
        const redovniSati = ukupnoSati - nocniSati - praznicniSati;
        const nocniBonus = parseFloat(radnik.nocni_bonus) || 0;
        const praznikBonus = parseFloat(radnik.praznik_bonus) || 0;
        const goProcenat = parseFloat(radnik.go_procenat) || 100;
        const bolovanjeProcenat = parseFloat(radnik.bolovanje_procenat) || 65;

        const zaradaOdRada = (redovniSati * osnovnaSatnica) + 
                             (nocniSati * osnovnaSatnica * (1 + (nocniBonus / 100))) + 
                             (praznicniSati * osnovnaSatnica * (1 + (praznikBonus / 100)));
                             
        const zaradaGO = satiGO * osnovnaSatnica * (goProcenat / 100);
        const zaradaBolovanje = satiBolovanje * osnovnaSatnica * (bolovanjeProcenat / 100);
        
        const ukupnaPlata = zaradaOdRada + zaradaGO + zaradaBolovanje;

        res.json({ 
          ukupnoSati: ukupnoSati.toFixed(1), 
          praznicniSati: praznicniSati.toFixed(1), 
          nocniSati: nocniSati.toFixed(1),
          satiGO, satiBolovanje,
          zaradaOdRada: zaradaOdRada.toFixed(2),
          zaradaGO: zaradaGO.toFixed(2),
          zaradaBolovanje: zaradaBolovanje.toFixed(2),
          plata: ukupnaPlata.toFixed(2), 
          satnica: osnovnaSatnica,
          goProcenat, bolovanjeProcenat
        });
      });
    });
  });
});

// NOVO: Render servisi sami dodeljuju PORT, pa ne smemo fiksirati na 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server pokrenut na portu ${PORT}`);
});