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

/** Positive genre weights as a percentage of all valid genre weights. */
export function genreBreakdown(tags: Record<string, number>) {
  const genres = Object.entries(tags)
    .filter(([tag, weight]) =>
      tag.startsWith('genre:') && tag.length > 'genre:'.length &&
      Number.isFinite(weight) && weight > 0,
    )
    .map(([tag, weight]) => ({ name: tag.slice('genre:'.length), weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'en'));
  const total = genres.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  return genres.map(({ name, weight }) => ({
    name,
    percentage: Math.round((weight / total) * 1000) / 10,
  }));
}
