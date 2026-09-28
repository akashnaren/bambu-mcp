export function jobName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\.gcode(\.3mf)?$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+-+\s+/g, " – ")
    .replace(/\s+/g, " ")
    .trim();
}

export function duration(min: number | null | undefined): string | null {
  if (min == null) return null;
  if (min <= 0) return "done";
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return `${hours ? `${hours} h ` : ""}${minutes || !hours ? `${minutes} min` : ""}`.trim();
}

export function baseName(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

const PRINTABLE =
  /^[A-Za-z0-9][A-Za-z0-9_]*-[A-Za-z0-9][A-Za-z0-9_]*-[A-Za-z0-9][A-Za-z0-9_]*\.gcode\.3mf$/;

/** Same refusal as the server, so the page can say why before it asks to confirm. */
export function printFileError(file: string): string | null {
  const name = baseName(file);
  if (/(^|[\\/])scratch([\\/]|$)/i.test(file)) return "Move the file out of scratch/ first.";
  if (name.toLowerCase().startsWith("wip-")) return "wip- files are not printable.";
  if (/\.stl$/i.test(name)) return "An STL has to be sliced to a .gcode.3mf first.";
  if (/\.3mf$/i.test(name) && !/\.gcode\.3mf$/i.test(name)) return "A mesh .3mf has to be sliced first.";
  if (!PRINTABLE.test(name)) return "Name the file {part}-{variant}-{rev}.gcode.3mf.";
  return null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function filamentColor(value: string | null | undefined): string | null {
  if (!value || !HEX.test(value)) return null;
  return value;
}
