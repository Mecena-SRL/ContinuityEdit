# NOTICE

ContinuityEdit
Copyright (C) 2026 Ivan Mazzone e Claude (Anthropic)

Questo programma e' software libero: puoi ridistribuirlo e/o modificarlo secondo i termini della
GNU General Public License come pubblicata dalla Free Software Foundation, either version 3 of
the License, or (at your option) any later version. Vedi il file `LICENSE`.

Questo programma e' distribuito nella speranza che sia utile, ma SENZA ALCUNA GARANZIA.

## Dipendenze runtime incluse nel plugin

| Pacchetto | Versione | Licenza |
|---|---|---|
| fast-xml-parser | 5.12.0 | MIT |
| pdfjs-dist (solo build `legacy`) | 6.5.438 | Apache-2.0 |

Dipendenze transitive di fast-xml-parser (tutte MIT): @nodable/entities, fast-xml-builder,
is-unsafe, path-expression-matcher, strnum, anynum, xml-naming.

Le licenze originali sono incluse nelle cartelle dei rispettivi pacchetti dentro il plugin installato.

## Componenti di terze parti NON ridistribuiti

`WorkflowIntegration.node` appartiene a Blackmagic Design ed e' soggetto alla sua licenza.
**Non e' ridistribuito** con ContinuityEdit ne' incluso nel .dmg: l'installer lo copia dalla
cartella Developer della copia di DaVinci Resolve Studio gia' installata sul computer dell'utente.

DaVinci Resolve e' un marchio di Blackmagic Design Pty Ltd. ScriptSync e' un marchio di Avid
Technology, Inc. ContinuityEdit non e' affiliato ne' approvato da tali societa'.
