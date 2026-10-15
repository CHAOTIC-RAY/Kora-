export interface SeoOptions {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  ogImage?: string;
}

export function setSeo(options: SeoOptions) {
  if (typeof document === "undefined") return;

  const baseTitle = "Kora";
  if (options.title) {
    document.title = options.title === baseTitle ? baseTitle : `${options.title} | ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }

  // Description
  if (options.description) {
    let metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.name = "description";
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = options.description;
  }

  // Canonical
  if (options.canonical) {
    let linkCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!linkCanonical) {
      linkCanonical = document.createElement("link");
      linkCanonical.rel = "canonical";
      document.head.appendChild(linkCanonical);
    }
    const origin = window.location.origin;
    linkCanonical.href = `${origin}${options.canonical.startsWith("/") ? "" : "/"}${options.canonical}`;
  }

  // Robots (noindex)
  let metaRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (options.noindex) {
    if (!metaRobots) {
      metaRobots = document.createElement("meta");
      metaRobots.name = "robots";
      document.head.appendChild(metaRobots);
    }
    metaRobots.content = "noindex, nofollow";
  } else if (metaRobots) {
    metaRobots.content = "index, follow";
  }
}
