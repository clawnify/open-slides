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
      // Slides are landscape; reveal's print stylesheet sizes each slide to the
      // full page, so no margins.
      landscape: true,
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
