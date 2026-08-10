const ROOTS = {
  main: "https://nce.mleo.site",
  "85": "https://85.mleo.site",
} as const;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const variant = params.get("variant") === "85" ? "85" : "main";
    const book = params.get("book") ?? "NCE1";
    if (!/^NCE[1-4]$/.test(book)) return Response.json({ error: "课程册数不正确" }, { status: 400 });
    const root = ROOTS[variant];
    const filename = params.get("filename");
    if (filename) {
      const response = await fetch(`${root}/${book}/${encodeURIComponent(filename)}.lrc`);
      if (!response.ok) return Response.json({ error: "课文字幕暂不可用" }, { status: response.status });
      return new Response(await response.text(), {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    const response = await fetch(`${root}/${book}/book.json`);
    if (!response.ok) return Response.json({ error: "课程目录暂不可用" }, { status: response.status });
    const data = await response.json() as { bookName?: string; bookLevel?: string; units?: { title: string; filename: string }[] };
    const units = (data.units ?? []).map((unit, index) => ({
      index: index + 1,
      key: `${variant}-${book}-${unit.filename}`,
      title: unit.title,
      filename: unit.filename,
      audioUrl: `${root}/${book}/${encodeURIComponent(unit.filename)}.mp3`,
      lrcUrl: `/api/nce?variant=${variant}&book=${book}&filename=${encodeURIComponent(unit.filename)}`,
    }));
    return Response.json({ book, variant, bookLevel: data.bookLevel ?? "", units }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "课程读取失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

