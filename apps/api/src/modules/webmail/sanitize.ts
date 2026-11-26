import sanitizeHtml from 'sanitize-html';

const SAFE_STYLE = /^[^<>"'`\\]*$/;
const styleProps = [
  'color', 'background-color', 'background', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-align',
  'text-decoration', 'line-height', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'border', 'border-top', 'border-bottom', 'border-left',
  'border-right', 'border-radius', 'border-collapse', 'width', 'max-width', 'min-width', 'height', 'vertical-align', 'display',
  'white-space', 'letter-spacing', 'text-transform', 'list-style-type',
];

export interface SanitizeOptions {
  allowRemoteImages: boolean;
  /** Maps cid: references to safe same-origin URLs (inline attachments). */
  cidMap: Record<string, string>;
}

export interface SanitizeResult {
  html: string;
  blockedRemoteImages: number;
  suspiciousLinks: number;
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Sanitises untrusted email HTML. Scripts, event handlers, forms, iframes, objects, meta refreshes and
 * javascript:/data: URLs are removed. Remote images are blocked by default (tracking pixels) and links are
 * forced to open in a new tab without referrer. The web client additionally renders the result inside a
 * sandboxed iframe without script permission.
 */
export function sanitizeEmailHtml(input: string, opts: SanitizeOptions): SanitizeResult {
  let blockedRemoteImages = 0;
  let suspiciousLinks = 0;
  const html = sanitizeHtml(input, {
    allowedTags: [
      'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
      'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's',
      'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'wbr',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel', 'data-jimail-warning'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-jimail-blocked'],
      td: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      th: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      table: ['width', 'border', 'cellpadding', 'cellspacing', 'align', 'bgcolor'],
      font: ['color', 'size', 'face'],
      '*': ['style', 'align', 'dir', 'lang'],
    },
    allowedStyles: { '*': Object.fromEntries(styleProps.map((p) => [p, [SAFE_STYLE]])) },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
    transformTags: {
      a: (tagName, attribs) => {
        const out: Record<string, string> = { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' };
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const src = attribs.src ?? '';
        const out: Record<string, string> = { ...attribs };
        if (src.startsWith('cid:')) {
          const mapped = opts.cidMap[src.slice(4).replace(/^<|>$/g, '')];
          if (mapped) out.src = mapped;
          else delete out.src;
        } else if (src.startsWith('data:')) {
          if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) delete out.src;
        } else if (/^https?:/i.test(src) && !opts.allowRemoteImages) {
          blockedRemoteImages++;
          delete out.src;
          out['data-jimail-blocked'] = 'remote-image';
        }
        return { tagName, attribs: out };
      },
    },
    textFilter: (text) => text,
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src && !frame.attribs['data-jimail-blocked'],
  });

  // Flag links whose visible text shows a different domain than the real destination (common phishing pattern).
  const flagged = html.replace(/<a ([^>]*?)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi, (whole, pre, href, post, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const shown = text.match(/^(https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/\S*)?$/i);
    const real = hostOf(href.replace(/&amp;/g, '&'));
    if (shown && real) {
      const shownHost = shown[2].toLowerCase().replace(/^www\./, '');
      if (shownHost !== real && !real.endsWith(`.${shownHost}`)) {
        suspiciousLinks++;
        return `<a ${pre}href="${href}"${post} data-jimail-warning="Link text shows ${shownHost} but opens ${real}" title="Caution: opens ${real}">${inner}</a>`;
      }
    }
    return whole;
  });
  return { html: flagged, blockedRemoteImages, suspiciousLinks };
}

/** Plain text → safe HTML (escaped, links clickable). */
export function textToHtml(text: string): string {
  const esc = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<div style="white-space:pre-wrap">${esc.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`)}</div>`;
}

const DANGEROUS_EXT = new Set([
  'exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1', 'msi', 'msp', 'jar', 'hta',
  'cpl', 'lnk', 'iso', 'img', 'vhd', 'dll', 'reg', 'docm', 'xlsm', 'pptm', 'apk', 'app', 'dmg', 'sh',
]);

export function attachmentRisk(name: string | null | undefined, type: string | null | undefined): 'dangerous' | 'safe' {
  const ext = (name ?? '').toLowerCase().split('.').pop() ?? '';
  if (DANGEROUS_EXT.has(ext)) return 'dangerous';
  if (/x-msdownload|x-msdos-program|x-sh|javascript|java-archive|x-ms-installer/i.test(type ?? '')) return 'dangerous';
  return 'safe';
}

export const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
