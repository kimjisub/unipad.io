import { PlayPage } from '@/components/play/PlayPage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/play');

export const dynamic = 'force-dynamic';

export default function Play() {
  return <PlayPage />;
}
