import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { OCR_TOOLS } from './paths.js';

const execFileP = promisify(execFile);
const SWIFT = '/usr/bin/swift';

// 复用工作区已有的本地 OCR（macOS Vision，中文，零联网）。若工作区不存在则尝试 tools 下自己的副本。
export async function ocrImage(imagePath) {
  const script = path.join(OCR_TOOLS, 'ocr.swift');
  if (!fs.existsSync(script)) {
    return '[OCR不可用: 未找到 ocr.swift]';
  }
  try {
    const { stdout } = await execFileP(SWIFT, [script, imagePath], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    const arr = JSON.parse(stdout);
    const text = arr[0]?.text ?? '[OCR失败]';
    return text;
  } catch (e) {
    return `[OCR失败: ${e.message}]`;
  }
}

export async function ocrImages(imagePaths) {
  const results = [];
  for (const p of imagePaths) {
    const text = await ocrImage(p);
    results.push({ file: path.basename(p), path: p, text });
  }
  return results;
}