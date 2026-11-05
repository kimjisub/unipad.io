/** The imported file's name without its extension, or undefined when nothing is left of it. */
export function packNameFromFileName(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  const name = dot < 0 ? fileName : fileName.slice(0, dot);
  return name.trim() ? name : undefined;
}

/**
 * The title shown for a pack in the list and its details: its own title, or the name of the file it
 * was imported from when the title is blank. Packs saved before file names were kept stay blank.
 */
export function packDisplayTitle(pack: { title: string; fileName?: string }): string {
  return pack.title.trim() ? pack.title : pack.fileName ?? pack.title;
}

/** The shown title when it names the pack, or undefined for a pack that is missing or has nothing to show. */
export function packIdentifyingTitle(pack: { title: string; fileName?: string } | undefined): string | undefined {
  const title = pack && packDisplayTitle(pack);
  return title?.trim() ? title : undefined;
}

/** The name a screen reader reads for a pack's row: its shown title, and its producer when it has one. */
export function packAccessibleName(pack: { title: string; fileName?: string; producerName: string }): string {
  const title = packDisplayTitle(pack);
  return pack.producerName.trim() ? `${title} by ${pack.producerName}` : title;
}
