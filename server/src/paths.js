import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url)); // server/src

export const ROOT = path.resolve(here, '../..');                       // 工作台根目录
export const CONFIG_DIR = path.join(ROOT, 'config');
export const MODELS_FILE = path.join(CONFIG_DIR, 'models.json');
export const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
export const DATA_DIR = path.join(ROOT, 'data');
export const LIB_NOTES = path.join(DATA_DIR, 'library/notes');
export const LIB_OCR = path.join(DATA_DIR, 'library/ocr');
export const LIB_INDEX = path.join(DATA_DIR, 'library/index.json');
export const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');
export const TOPICS_FILE = path.join(DATA_DIR, 'topics.json');
export const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');
export const IMAGE_PLANS_DIR = path.join(DATA_DIR, 'image_plans');
export const JOBS_DIR = path.join(DATA_DIR, 'jobs');
export const OUT_IMAGES = path.join(ROOT, 'output/images');
export const OUT_REPORTS = path.join(ROOT, 'output/reports');
export const TMP_DIR = path.join(ROOT, 'tmp');
export const CORE_SKILLS_DIR = path.join(ROOT, 'server', 'skills-core');
export const OCR_TOOLS = path.join(ROOT, 'tools');

// OpenCLI：优先使用 npm 依赖（随根目录 npm install 自动安装），回退到仓库内 vendor 副本；均可被环境变量覆盖
export const VENDOR_OPENCLI = path.join(ROOT, 'vendor', 'opencli');
const resolveOpencliMain = () => {
  try {
    return createRequire(import.meta.url).resolve('@jackwener/opencli');
  } catch {
    return path.join(VENDOR_OPENCLI, 'dist', 'src', 'main.js');
  }
};
export const OPENCLI_NODE = process.env.OPENCLI_NODE || 'node';
export const OPENCLI_MAIN = process.env.OPENCLI_MAIN || resolveOpencliMain();