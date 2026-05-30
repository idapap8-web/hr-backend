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

      // Osiguravamo da su smene niz, čak i ako je baza vratila prazno
      const sigurneSmene = Array.isArray(smene) ? smene : [];

      sigurneSmene.forEach(smena => {
        const pVal = (smena.pocetak || '').toUpperCase().trim();
        
        // 1. Provera za Godišnji odmor i Bolovanje unete direktno u planer
        if (pVal === 'GO') { satiGO += 8; return; }
        if (pVal === 'BOL' || pVal === 'BOLOVANJE') { satiBolovanje += 8; return; }
        if (!smena.pocetak || !smena.kraj) return;

        // 2. Pretvaranje vremena (npr "08:00") u brojeve uz sigurnosnu proveru
        let pDelovi = smena.pocetak.split(':');
        let kDelovi = smena.kraj.split(':');
        if (pDelovi.length === 0 || kDelovi.length === 0) return;

        let p = parseInt(pDelovi[0]);
        let k = parseInt(kDelovi[0]);
        if (isNaN(p) || isNaN(k)) return;
        if (k === 0) k = 24;

        let trajanje = k > p ? k - p : 24 - p + k;
        ukupnoSati += trajanje;

        // 3. Sigurno računanje noćnih sati
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

      // 4. Sigurna matematika sa platama (izbegavamo NaN greške ako su polja prazna)
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

      // Slanje čistih podataka nazad u React aplikaciju
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
