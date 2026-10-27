/** The three strongest listening decades, using the same weighted tags as taste matching. */
export function favoriteDecades(tags: Record<string, number>) {
  return Object.entries(tags)
    .filter(([tag, weight]) =>
      tag.startsWith('decade:') && tag.length > 'decade:'.length &&
      Number.isFinite(weight) && weight > 0,
    )
    .map(([tag, weight]) => ({ decade: tag.slice('decade:'.length), weight }))
    .sort((a, b) => b.weight - a.weight || a.decade.localeCompare(b.decade, 'en'))
    .slice(0, 3);
}
