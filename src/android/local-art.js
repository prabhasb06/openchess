const tile = (body) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

export const localPiece = (piece, style) => {
  if (style === "violet") return `/chess-local/pieces/${piece}.png`;
  return `/chess-local/amber/${piece}.png`;
};
export const localBoards = [
  { id: "green", name: "Green", light: "#eeeed2", dark: "#769656" },
  { id: "slate", name: "Slate", light: "#d9e1f4", dark: "#7786ad" },
  { id: "lagoon", name: "Lagoon", light: "#d6f1e9", dark: "#61948e" },
  { id: "clay", name: "Clay", light: "#f5e0c5", dark: "#ab7e72" },
];
export const localBoard = (id) => localBoards.find((board) => board.id === id) || localBoards[0];
export const localLogo = tile(`
  <rect width="64" height="64" rx="15" fill="#292d28"/>
  <path d="M15 14h15v15H15zm19 19h15v15H34z" fill="#9fbb86"/>
  <path d="M34 14h15v15H34zM15 33h15v15H15z" fill="#ded7b2"/>
  <circle cx="42" cy="41" r="4" fill="#292d28"/>
`);
export const localAvatar = tile(`
  <rect width="64" height="64" rx="14" fill="#334161"/>
  <circle cx="32" cy="25" r="8" fill="#c5e8e4"/>
  <path d="M15 49c0-13 34-13 34 0" fill="#c5e8e4"/>
`);
export const localCoach = tile(`
  <rect width="64" height="64" rx="14" fill="#354978"/>
  <path d="M13 21l19-9 19 9v22l-19 9-19-9z" fill="#c1b4f9"/>
  <path d="M22 27h5m10 0h5m-17 11h14" stroke="#273251" stroke-width="4" stroke-linecap="round"/>
`);
export function localBotAvatar(bot) {
  const hue = Array.from(bot?.id || "local").reduce((sum, ch) => sum + ch.codePointAt(0), 0) % 360;
  return tile(`
    <rect width="64" height="64" rx="14" fill="hsl(${hue} 42% 26%)"/>
    <circle cx="32" cy="32" r="21" fill="hsl(${hue} 54% 64%)"/>
    <rect x="17" y="24" width="30" height="19" rx="7" fill="#1a2540"/>
    <path d="M24 32h3m10 0h3" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
  `);
}
