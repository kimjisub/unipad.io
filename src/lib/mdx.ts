import fs from 'fs';
import path from 'path';

const CONTENT_DIR = path.join(process.cwd(), 'content/docs');

export function loadMdxContent(locale: string, slug: string): string {
  const filePath = path.join(CONTENT_DIR, locale, `${slug}.mdx`);

  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }

  const fallbackPath = path.join(CONTENT_DIR, 'en', `${slug}.mdx`);
  return fs.readFileSync(fallbackPath, 'utf-8');
}
