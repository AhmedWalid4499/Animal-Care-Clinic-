// Browser-tab icons for the public pages (14 Nov 2026, Ahmed): a person for the owner's page, a paw for a pet (the
// collar tag page, and a pet's profile inside the owner's page). Inline SVG data URLs: the pages' CSP allows data:
// images and nothing else needs serving.
const svg = (body) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
export const OWNER_ICON = svg('<rect width="64" height="64" rx="14" fill="#2e6f73"/><circle cx="32" cy="23" r="10" fill="#fff"/><path d="M13 53c2-11 9.5-16 19-16s17 5 19 16z" fill="#fff"/>');
export const PET_ICON = svg('<circle cx="32" cy="32" r="32" fill="#2e6f73"/><ellipse cx="32" cy="42" rx="11" ry="9" fill="#fff"/><ellipse cx="17.5" cy="30" rx="5" ry="6.5" fill="#fff"/><ellipse cx="25.5" cy="19.5" rx="5" ry="6.5" fill="#fff"/><ellipse cx="38.5" cy="19.5" rx="5" ry="6.5" fill="#fff"/><ellipse cx="46.5" cy="30" rx="5" ry="6.5" fill="#fff"/>');
