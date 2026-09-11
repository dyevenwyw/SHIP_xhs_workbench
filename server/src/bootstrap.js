import fs from 'fs';
import { DATA_DIR, LIB_NOTES, LIB_OCR, ANALYSIS_DIR, DRAFTS_DIR, IMAGE_PLANS_DIR, JOBS_DIR, OUT_IMAGES, OUT_REPORTS, TMP_DIR, CONFIG_DIR } from './paths.js';

const dirs = [DATA_DIR, LIB_NOTES, LIB_OCR, ANALYSIS_DIR, DRAFTS_DIR, IMAGE_PLANS_DIR, JOBS_DIR, OUT_IMAGES, OUT_REPORTS, TMP_DIR, CONFIG_DIR];

export function ensureDirs() {
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}