// Parser Final Draft (.fdx) -> ScriptDoc (vedi docs/CONTRACTS.md).
// Usa fast-xml-parser con preserveOrder per mantenere l'ordine dei Paragraph
// (anche dentro <DualDialogue>) e dei <Text> multipli con stili diversi.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
});

const TYPE_MAP = {
  'scene heading': 'scene',
  action: 'action',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
  general: 'action',
};

// Formato preserveOrder: nodo = { Tag: [figli], ':@': attrs } oppure { '#text': 'x' }.
const tagOf = (node) => Object.keys(node).find((k) => k !== ':@');
const childrenOf = (node) => {
  const t = tagOf(node);
  return t && Array.isArray(node[t]) ? node[t] : [];
};
const attrsOf = (node) => node[':@'] || {};

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** Concatena i #text dei discendenti di un nodo <Text> (o dei nodi dati). */
function rawText(nodes) {
  let out = '';
  for (const n of nodes) {
    if ('#text' in n) out += String(n['#text']);
    else out += rawText(childrenOf(n));
  }
  return out;
}

/** Paragraph in ordine di documento (entra anche in <DualDialogue>). */
function collectParagraphs(nodes, acc) {
  for (const n of nodes) {
    const t = tagOf(n);
    // Paragraph contenitore di <DualDialogue>: si scende ai Paragraph interni.
    if (t === 'Paragraph' && !childrenOf(n).some((c) => tagOf(c) === 'DualDialogue')) acc.push(n);
    else if (t && t !== '#text') collectParagraphs(childrenOf(n), acc);
  }
  return acc;
}

/** Solo i <Text> diretti: SceneProperties/ScriptNote ecc. non contano. */
function paragraphText(p) {
  return clean(rawText(childrenOf(p).filter((c) => tagOf(c) === 'Text')));
}

/** "anna (V.O.) (CONT'D)" -> { name: 'ANNA', ext: "(V.O.) (CONT'D)" } */
export function splitCharacter(raw) {
  const exts = [];
  const stripped = raw.replace(/\([^)]*\)/g, (m) => {
    exts.push(clean(m));
    return ' ';
  });
  const name = clean(stripped.replace(/\^\s*$/, '')).toLocaleUpperCase('it');
  return { name, ext: exts.length ? exts.join(' ') : null };
}

export function parseFdx(xmlString) {
  const xml = String(xmlString).replace(/^﻿/, '').trim();
  const tree = parser.parse(xml);
  const root = tree.find((n) => tagOf(n) === 'FinalDraft');
  const rootKids = root ? childrenOf(root) : [];

  // Titolo: primo paragrafo non vuoto della TitlePage (se presente).
  let title = '';
  const tp = rootKids.find((n) => tagOf(n) === 'TitlePage');
  if (tp) {
    for (const p of collectParagraphs(childrenOf(tp), [])) {
      const t = paragraphText(p);
      if (t) {
        title = t;
        break;
      }
    }
  }

  const content = rootKids.find((n) => tagOf(n) === 'Content');
  const paragraphs = content ? collectParagraphs(childrenOf(content), []) : [];

  const lines = [];
  const scenes = [];
  let scene = null;
  let curChar = null; // { name, ext } della battuta corrente
  let curDialogue = null; // riga dialogue aperta

  const newScene = (heading) => {
    scene = { id: 'S' + String(scenes.length + 1).padStart(3, '0'), heading, lineIds: [] };
    scenes.push(scene);
  };
  const push = (type, text, character = null, characterExt = null) => {
    if (!scene) newScene(''); // scena senza heading iniziale
    const id = 'L' + String(lines.length + 1).padStart(4, '0');
    const line = { id, order: lines.length, type, character, text, sceneId: scene.id };
    if (characterExt) line.characterExt = characterExt;
    lines.push(line);
    scene.lineIds.push(id);
    return line;
  };

  for (const p of paragraphs) {
    const rawType = String(attrsOf(p)['@_Type'] ?? 'Action').trim().toLowerCase();
    const type = TYPE_MAP[rawType] || 'action';
    const text = paragraphText(p);
    if (!text) continue; // righe vuote

    if (type === 'scene') {
      newScene(text);
      push('scene', text);
      curChar = curDialogue = null;
    } else if (type === 'character') {
      curChar = splitCharacter(text);
      curDialogue = null;
      push('character', curChar.name, curChar.name, curChar.ext);
    } else if (type === 'dialogue') {
      if (curDialogue) {
        curDialogue.text += ' ' + text; // dialoghi consecutivi (anche dopo parentetiche)
      } else {
        curDialogue = push('dialogue', text, curChar?.name ?? null, curChar?.ext);
      }
    } else if (type === 'parenthetical') {
      push('parenthetical', text, curChar?.name ?? null);
    } else {
      curChar = curDialogue = null;
      push(type, text);
    }
  }

  return { title, source: 'fdx', scenes, lines };
}
