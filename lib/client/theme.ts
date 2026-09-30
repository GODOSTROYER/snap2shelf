/**
 * The few places that need literal colours (third-party widgets that can't
 * read CSS variables). Mirrors the @theme tokens in app/globals.css.
 */
export const TOKENS = {
  studio: "#15110D",
  stage: "#1D1712",
  stage2: "#282019",
  stage3: "#362B21",
  paper: "#F5EDE1",
  dim: "#B9AC98",
  marigold: "#F5A524",
  sindoor: "#F26A52",
  leaf: "#97D48D",
} as const;

/** Cloudinary Upload Widget palette in the studio colours. */
export const UPLOAD_WIDGET_STYLES = {
  palette: {
    window: TOKENS.stage,
    windowBorder: TOKENS.stage3,
    tabIcon: TOKENS.marigold,
    menuIcons: TOKENS.dim,
    textDark: TOKENS.studio,
    textLight: TOKENS.paper,
    link: TOKENS.marigold,
    action: TOKENS.marigold,
    inactiveTabIcon: TOKENS.dim,
    error: TOKENS.sindoor,
    inProgress: TOKENS.marigold,
    complete: TOKENS.leaf,
    sourceBg: TOKENS.studio,
  },
  fonts: { default: null, "'Hanken Grotesk', sans-serif": { url: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600", active: true } },
};
