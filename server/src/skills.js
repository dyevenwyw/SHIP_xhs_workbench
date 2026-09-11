import fs from 'fs';
import path from 'path';
import { CORE_SKILLS_DIR } from './paths.js';

/**
 * 解析 SKILL.core.md 的 frontmatter（name / label / source / type）与正文。
 * frontmatter 用 --- 包裹，简单 key: value 解析，value 去首尾引号。
 */
function parseFrontmatter(raw) {
  const fm = {};
  let body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    m[1].split('\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > -1) {
        const k = line.slice(0, idx).trim();
        let v = line.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k) fm[k] = v;
      }
    });
    body = raw.replace(/^---\n[\s\S]*?\n---/, '').trim();
  }
  return { fm, body };
}

/** 内存缓存：目录 mtime 未变且未超过 TTL 时直接复用，避免每次调用都读盘+解析 */
const CORE_CACHE_TTL_MS = 10000;
let _coreCache = null; // { at, dirMtime, list }

function readCoreFile(name) {
  if (!name) return null;
  const p = path.join(CORE_SKILLS_DIR, String(name) + '.md');
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    const label = fm.label || fm.name || String(name);
    return {
      name: fm.name || String(name),
      file: String(name),
      path: p,
      sk: body,
      label,
      summary: label,
    };
  } catch {
    return null;
  }
}

/**
 * 列出本地 skills-core 目录下的所有 core skill（扁平 *.md）。
 * @returns {Array<{name,file,path,sk,label,summary}>}
 */
export function listSkills() {
  if (!fs.existsSync(CORE_SKILLS_DIR)) return [];
  const now = Date.now();
  let dirMtime = 0;
  try { dirMtime = fs.statSync(CORE_SKILLS_DIR).mtimeMs; } catch {}
  if (_coreCache && _coreCache.dirMtime === dirMtime && now - _coreCache.at < CORE_CACHE_TTL_MS) {
    return _coreCache.list;
  }
  let list = [];
  try {
    list = fs.readdirSync(CORE_SKILLS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => readCoreFile(f.replace(/\.md$/, '')))
      .filter(Boolean);
  } catch {
    list = [];
  }
  _coreCache = { at: now, dirMtime, list };
  return list;
}

/** 按 core 文件名直读单个 skill（带缓存，不触发全目录重复解析） */
export function getSkillByName(name) {
  return readCoreFile(name);
}

/**
 * 构建某次文案生成的 system prompt：基础要求 + 所选 core skill 的方法论正文。
 * @param {string} skillName  core 文件名（如 viral-note），对应 skills-core/<name>.md
 * @param {string} extraBase  额外基础指令
 */
export function buildPromptWithSkill(skillName, extraBase = '') {
  const parts = [];
  if (extraBase) parts.push(extraBase);
  const skill = getSkillByName(skillName);
  if (skill) {
    parts.push(`请严格按照以下 skill 的方法论来创作（这是你在本次任务中采用的创作方法）：\n\n---BEGIN SKILL: ${skill.name}---\n${skill.sk}\n---END SKILL---\n`);
  } else {
    parts.push('（未指定 skill，请以通用小红书爆款文案标准创作）');
  }
  return parts.join('\n\n');
}
