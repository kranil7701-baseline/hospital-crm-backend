export function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export function buildFieldWordSearchCondition(fieldName: string, search: string) {
  const trimmed = (search || "").trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return { [fieldName]: { $regex: escapeRegex(trimmed), $options: "i" } };
  }
  return {
    $and: words.map((w) => ({
      [fieldName]: { $regex: escapeRegex(w), $options: "i" },
    })),
  };
}
