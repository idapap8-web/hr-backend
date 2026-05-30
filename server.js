const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection(process.env.DATABASE_URL || {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'radno_vreme'
});

db.connect(err => {
  if (err) {
    console.error('Greška pri povezivanju sa bazom:', err);
    return;
  }
  console.log('Uspešno povezano sa bazom podataka!');
  
  // KREIRANJE TABELA AKO NE POSTOJE
  db.query(`CREATE TABLE IF NOT EXISTS zaposleni (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ime VARCHAR(255) NOT NULL,
    prezime VARCHAR(255) NOT NULL,
    pozicija VARCHAR(255),
    satnica DECIMAL(10,2) DEFAULT 0,
    nocna_pocetak VARCHAR(5) DEFAULT '22:00',
    nocna_kraj VARCHAR(5) DEFAULT '06:00',
    nocni_bonus INT DEFAULT 26,
    praznik_bonus INT DEFAULT 110,
    go_procenat INT DEFAULT 100,
    bolovanje_procenat INT DEFAULT 65
  )`);

  db.query(`CREATE TABLE IF NOT EXISTS raspored (
    id INT AUTO_INCREMENT PRIMARY KEY,
    zaposleni_id INT,
    datum DATE NOT NULL,
    pocetak VARCHAR(5),
    kraj VARCHAR(5),
    UNIQUE KEY radnik_datum (zaposleni_id, datum)
  )`);

  db.query(`CREATE TABLE IF NOT EXISTS odsustva (
    id INT AUTO_INCREMENT PRIMARY KEY,
    zaposleni_id INT,
    datum_od DATE NOT NULL,
    datum_do DATE NOT NULL,
    tip VARCHAR(20) DEFAULT 'GO'
  )`);
});

// === RUTE ZA ZAPOSLENE ===

app.get('/zaposleni', (req, res) => {
  db.query('SELECT * FROM zaposleni', (err, results) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json(Array.isArray(results) ? results : []);
  });
});

app.post('/zaposleni', (req, res) => {
  db.query('INSERT INTO zaposleni SET ?', req.body, (err, result) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json({ id: result.insertId, ...req.body });
  });
});

app.put('/zaposleni/:id', (req, res) => {
  db.query('UPDATE zaposleni SET ? WHERE id = ?', [req.body, req.params.id], (err) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json({ id: req.params.id, ...req.body });
  });
});

app.delete('/zaposleni/:id', (req, res) => {
  db.query('DELETE FROM zaposleni WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json({ poruka: "Obrisan radnik" });
  });
});

// === RUTE ZA RASPORED (SA ZAŠTITOM OD GREŠKE 500) ===

app.get('/raspored', (req, res) => {
  db.query('SELECT zaposleni_id, DATE_FORMAT(datum, "%Y-%m-%d") as datum, pocetak, kraj FROM raspored', (err, results) => {
    if (err) {
      console.error("Greška pri čitanju rasporeda:", err);
      return res.status(500).json({ greska: "Greška na serveru", detalji: err.message });
    }
    res.json(Array.isArray(results) ? results : []);
  });
});

app.post('/raspored', (req, res) => {
  const { zaposleni_id, datum, pocetak, kraj } = req.body;
  if (!zaposleni_id || !datum) {
    return res.status(400).json({ greska: "Nedostaju zaposleni_id ili datum!" });
  }

  const q = 'INSERT INTO raspored (zaposleni_id, datum, pocetak, kraj) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE pocetak = ?, kraj = ?';
  db.query(q, [zaposleni_id, datum, pocetak, kraj, pocetak, kraj], (err, result) => {
    if (err) {
      console.error("Greška pri upisivanju smene:", err);
      return res.status(500).json({ greska: "Baza je odbila upis", detalji: err.message });
    }
    res.json({ status: "Sačuvano" });
  });
});

// === RUTE ZA ODSUSTVA ===

app.get('/odsustva', (req, res) => {
  db.query('SELECT id, zaposleni_id, DATE_FORMAT(datum_od, "%Y-%m-%d") as datum_od, DATE_FORMAT(datum_do, "%Y-%m-%d") as datum_do, tip FROM odsustva', (err, results) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json(Array.isArray(results) ? results : []);
  });
});

app.post('/odsustva', (req, res) => {
  db.query('INSERT INTO odsustva SET ?', req.body, (err) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json({ status: "Odsustvo dodato" });
  });
});

app.delete('/odsustva/:id', (req, res) => {
  db.query('DELETE FROM odsustva WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ greska: err.message });
    res.json({ status: "Obrisano odsustvo" });
  });
});

// === RUTA ZA AUTOMATSKI OBRAČUN PLATE (POTPUNO UKREPLJENA) ===

app.get('/izvestaj/:id', (req, res) => {
  const radnikId = req.params.id;
  const { mesec, godina } = req.query;

  if (!mesec || !godina) {
    return res.status(400).json({ poruka: "Nedostaju mesec ili godina" });
  }

  db.query('SELECT * FROM zaposleni WHERE id = ?', [radnikId], (err, radnikRes) => {
    if (err) {
      console.error("Greška pri traženju radnika:", err);
      return res.status(500).json({ poruka: "Greška na serveru pri čitanju radnika" });
    }
    if (!radnikRes || radnikRes.length === 0) {
      return res.status(404).json({ poruka: "Radnik nije nađen u bazi" });
    }
    
    const radnik = radnikRes[0];
    const qSmene = 'SELECT * FROM raspored WHERE zaposleni_id = ? AND MONTH(datum) = ? AND YEAR(datum) = ?';
    
    db.query(qSmene, [radnikId, mesec, godina], (err, smene) => {
      if (err) {
        console.error("Greška pri čitanju smena za izveštaj:", err);
        return res.status(500).json({ poruka: "Greška na serveru pri čitanju smena" });
      }

      let ukupnoSati = 0; 
      let nocniSati = 0; 
      let praznicniSati = 0; 
      let satiGO = 0; 
      let satiBolovanje = 0;

      const sigurneSmene = Array.isArray(smene) ? smene : [];

      sigurneSmene.forEach(smena => {
        const pVal = (smena.pocetak || '').toUpperCase().trim();
        
        // 1. Evidencija odsustva upisanih direktno u planer
        if (pVal === 'GO') { satiGO += 8; return; }
        if (pVal === 'BOL' || pVal === 'BOLOVANJE') { satiBolovanje += 8; return; }
        if (!smena.pocetak || !smena.kraj) return;

        // 2. Pretvaranje teksta "08:00" u sate bezbedno
        let pDelovi = smena.pocetak.split(':');
        let kDelovi = smena.kraj.split(':');
        if (pDelovi.length === 0 || kDelovi.length === 0) return;

        let p = parseInt(pDelovi[0]);
        let k = parseInt(kDelovi[0]);
        if (isNaN(p) || isNaN(k)) return;
        if (k === 0) k = 24;

        let trajanje = k > p ? k - p : 24 - p + k;
        ukupnoSati += trajanje;

        // 3. Bezbedno računanje noćnih sati
        let nocnaPocetakTekst = radnik.nocna_pocetak || '22:00';
        let nocnaKrajTekst = radnik.nocna_kraj || '06:00';
        
        let n_poc = parseInt(nocnaPocetakTekst.split(':')[0]) || 22;
        let n_kr = parseInt(nocnaKrajTekst.split(':')[0]) || 6;

        for (let sat = p; sat !== k; sat = (sat + 1) % 24) {
          if (n_poc > n_kr) {
            if (sat >= n_poc || sat < n_kr) nocniSati++;
          } else {
            if (sat >= n_poc && sat < n_kr) nocniSati++;
          }
        }
      });

      // 4. Matematika i procenti obračuna
      const satnica = parseFloat(radnik.satnica || 0);
      const nocniBonusProcenat = parseInt(radnik.nocni_bonus) || 26;
      const goProcenat = parseInt(radnik.go_procenat) || 100;
      const bolovanjeProcenat = parseInt(radnik.bolovanje_procenat) || 65;

      const zaradaRedovna = Math.max(0, ukupnoSati - nocniSati) * satnica;
      const cenaNocnog = satnica * (1 + nocniBonusProcenat / 100);
      const zaradaNocna = nocniSati * cenaNocnog;
      
      const zaradaOdRada = zaradaRedovna + zaradaNocna;
      const zaradaGO = satiGO * satnica * (goProcenat / 100);
      const zaradaBolovanje = satiBolovanje * satnica * (bolovanjeProcenat / 100);
      const ukupnaPlata = zaradaOdRada + zaradaGO + zaradaBolovanje;

      // Slanje nazad objekt koji React tačno mapira u modalu
      res.json({
        satnica: satnica, 
        ukupnoSati: ukupnoSati, 
        nocniSati: nocniSati, 
        praznicniSati: praznicniSati,
        satiGO: satiGO, 
        satiBolovanje: satiBolovanje, 
        goProcenat: goProcenat, 
        bolovanjeProcenat: bolovanjeProcenat,
        zaradaOdRada: Math.round(zaradaOdRada), 
        zaradaGO: Math.round(zaradaGO), 
        zaradaBolovanje: Math.round(zaradaBolovanje),
        plata: Math.round(ukupnaPlata)
      });
    });
  });
});

// Pokretanje lokalnog servera na portu 3000
const PORT = 3000;
app.listen(PORT, () => console.log(`Server uspešno radi na portu ${PORT}`));
