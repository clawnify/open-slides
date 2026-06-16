// Renders a print-mode reveal.js HTML doc to PDF via Clawnify's managed PDF
// service (the same primitive open-books uses for invoices). The service runs
// Cloudflare Browser Rendering's page.pdf() under the hood — see
// services.clawnify.com/pdf/render. Slides come back one-per-page because the
// HTML puts reveal.js into print-pdf mode (pdfMaxPagesPerSlide: 1).

export class PdfRenderError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: string) {
    super(message);
    this.name = "PdfRenderError";
  }
}

export async function renderDeckPdf(token: string, html: string): Promise<ArrayBuffer> {
  const res = await fetch("https://services.clawnify.com/pdf/render", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      html,
      // Render at exactly the slide size. reveal lays a slide out relative to the
      // viewport, so a larger (default) viewport scales the 1280x720 canvas up
      // and it overflows the page. Pinning the viewport to 1280x720 makes reveal
      // render 1:1.
      viewport: { width: 1280, height: 720 },
      // reveal's print mode injects `@page { size: 1280px 720px; margin: 0 }`.
      // prefer_css_page_size makes Browser Rendering honor that exact page size
      // instead of defaulting to Letter portrait — without it every 1280x720
      // slide lands in the top strip and the rest bleeds onto the next page.
      // (Cloudflare's REST /pdf supports preferCSSPageSize/format, not pixel
      // width/height, so we drive the size from the document's own CSS.)
      prefer_css_page_size: true,
      print_background: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PdfRenderError(
      `PDF service responded ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  return res.arrayBuffer();
}
