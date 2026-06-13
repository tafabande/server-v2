export function flattenLibrary(groups = []) {
  return groups.flatMap((group) => group.items || []);
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Runtime unknown";
  }

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatRuntimeHours(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0h";
  }

  const hours = seconds / 3600;
  if (hours < 10) {
    return `${hours.toFixed(1)}h`;
  }
  return `${Math.round(hours)}h`;
}

export function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }
  if (size < 1024 * 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatResolution(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "Resolution unknown";
  }
  return `${width} x ${height}`;
}

export function formatDateLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function summarizeLibrary(groups = []) {
  const items = flattenLibrary(groups);
  
  const stats = items.reduce((acc, item) => {
    acc.runtime += (item.duration_seconds || 0);
    if (item.stream_mode === "direct") acc.direct++;
    if (item.stream_mode === "hls") acc.hls++;
    if (item.requires_pin) acc.locked++;
    if (item.adult_only) acc.adult++;
    return acc;
  }, { runtime: 0, direct: 0, hls: 0, locked: 0, adult: 0 });

  const topCategories = [...groups]
    .sort((left, right) => right.items.length - left.items.length)
    .slice(0, 4)
    .map((group) => ({ label: group.label, count: group.items.length }));

  return {
    itemCount: items.length,
    groupCount: groups.length,
    totalRuntimeSeconds: stats.runtime,
    runtimeLabel: formatRuntimeHours(stats.runtime),
    lockedCount: stats.locked,
    adultCount: stats.adult,
    directCount: stats.direct,
    hlsCount: stats.hls,
    topCategories,
  };
}
