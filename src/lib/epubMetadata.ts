import JSZip from "jszip";

export async function injectMetadataIntoEpub(
  fileBlob: Blob,
  title: string,
  author: string,
  description?: string,
  publisher?: string,
  year?: string
): Promise<Blob> {
  try {
    const zip = await JSZip.loadAsync(fileBlob);
    let opfPath = "";

    const containerFile = zip.file("META-INF/container.xml");
    if (containerFile) {
      const containerXml = await containerFile.async("text");
      const parser = new DOMParser();
      const doc = parser.parseFromString(containerXml, "text/xml");
      const rootfile = doc.querySelector("rootfile");
      if (rootfile) {
        opfPath = rootfile.getAttribute("full-path") || "";
      }
    }

    if (!opfPath) {
      opfPath = Object.keys(zip.files).find(name => name.endsWith(".opf")) || "";
    }

    if (opfPath) {
      const opfFile = zip.file(opfPath);
      if (opfFile) {
        const opfText = await opfFile.async("text");
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfText, "text/xml");

        const metadataNode = doc.querySelector("metadata") || doc.querySelector("opf\\:metadata");
        if (metadataNode) {
          const setMetadataTag = (tagName: string, value: string, attributes?: Record<string, string>) => {
            let el = doc.querySelector(tagName.replace(":", "\\:"));
            if (!el) {
              const localName = tagName.split(":").pop() || tagName;
              el = doc.querySelector(localName);
            }
            if (el) {
              el.textContent = value;
            } else {
              const newEl = doc.createElementNS("http://purl.org/dc/elements/1.1/", tagName);
              newEl.textContent = value;
              if (attributes) {
                Object.entries(attributes).forEach(([k, v]) => newEl.setAttribute(k, v));
              }
              metadataNode.appendChild(newEl);
            }
          };

          setMetadataTag("dc:title", title);
          setMetadataTag("dc:creator", author, { "opf:role": "aut" });
          if (description) {
            setMetadataTag("dc:description", description);
          }
          if (publisher) {
            setMetadataTag("dc:publisher", publisher);
          }
          if (year) {
            setMetadataTag("dc:date", year);
          }

          const serializer = new XMLSerializer();
          const updatedOpfText = serializer.serializeToString(doc);
          zip.file(opfPath, updatedOpfText);

          const newBlob = await zip.generateAsync({
            type: "blob",
            mimeType: "application/epub+zip",
            compression: "DEFLATE",
            compressionOptions: { level: 5 }
          });
          return newBlob;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to inject metadata into EPUB file:", err);
  }
  return fileBlob;
}
