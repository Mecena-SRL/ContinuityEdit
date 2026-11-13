# ContinuityEdit — Guida utente (v0.0.1)

ContinuityEdit e' un plugin per **DaVinci Resolve Studio** (macOS) che collega la sceneggiatura alle clip girate, in stile ScriptSync di Avid: per ogni riga di copione mostra quali take la coprono.

## Installazione dal .dmg

1. Apri `ContinuityEdit-0.0.1.dmg`.
2. L'app **Installa ContinuityEdit** non e' firmata: al primo avvio fai **tasto destro > Apri**, poi conferma **Apri** nel dialogo di macOS.
3. Se macOS la blocca comunque, togli la quarantena da Terminale (adatta il percorso se hai copiato l'app altrove):

   ```
   sudo xattr -dr com.apple.quarantine "/Volumes/ContinuityEdit 0.0.1/Installa ContinuityEdit.app"
   ```

4. Inserisci la password di amministratore quando richiesta. L'installer copia il plugin in
   `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/`
   e prende da Resolve il modulo `WorkflowIntegration.node` (appartiene a Blackmagic Design e non e' incluso nel .dmg).
5. Riavvia DaVinci Resolve Studio.

Requisiti: macOS, DaVinci Resolve **Studio** installato per intero (con la cartella Developer).

Se Resolve non carica il modulo di Blackmagic, togli la quarantena al plugin:

```
sudo xattr -dr com.apple.quarantine "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.continuityedit.plugin"
```

## PRIMA di usare ContinuityEdit

1. **Sincronizza e trascrivi le clip in Resolve.** Metti a sync audio e video, poi su ogni clip: tasto destro > **Transcribe Audio**. Crea la timeline.
2. **Organizza il Media Pool in cartelle per scena** (una cartella per scena, con dentro i take).
3. **Apri una o piu' cartelle di scena** nel Media Pool.
4. **Apri una timeline.**
5. Vai su **Workspace > Workflow Integrations > ContinuityEdit**.
6. **Importa la sceneggiatura** in formato FDX (Final Draft) o PDF.

Poi aggiungi i take, lancia la sincronizzazione automatica e controlla la copertura per riga: le barre colorate mostrano quali take coprono ogni battuta.

## Limiti noti (v0.0.1)

- Nessun controllo del visore sorgente di Resolve.
- Nessuna commutazione multicam live.
- Il PDF dipende dalla qualita' del testo estratto: se possibile preferisci l'FDX.
- Alcune azioni sulla API di Resolve sono da verificare sul campo (anteprima riga, assemblaggio timeline).

## Disinstallazione

Chiudi Resolve ed elimina la cartella del plugin da Terminale:

```
sudo rm -rf "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.continuityedit.plugin"
```

Se hai il codice sorgente: `scripts/install-mac.sh --uninstall`. I salvataggi dei progetti (`.ce.json`) restano nella cartella dati del plugin.

## Risoluzione problemi

- **Il plugin non compare nel menu**: riavvia Resolve; verifica di avere la versione Studio; controlla che la cartella del plugin esista (vedi sopra).
- **"WorkflowIntegration.node non trovato"**: reinstalla Resolve Studio in modo completo, la cartella Developer deve esistere.
- **Il modulo non si carica**: togli la quarantena (comando sopra) e riavvia Resolve.
- **L'app installer non si apre**: tasto destro > Apri, oppure usa il comando `xattr` dell'installazione.
- **Nessuna copertura per una clip**: la clip non e' stata trascritta; esegui Transcribe Audio e riprova.
- **Diagnostica**: dal plugin esegui la diagnostica; salva `~/Desktop/continuityedit_diag.json`, utile per segnalare problemi.

## Licenza

GNU GPL v3 o successiva. Vedi `LICENSE` e `NOTICE.md`.
