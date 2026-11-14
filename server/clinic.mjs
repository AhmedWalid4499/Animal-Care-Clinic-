// The clinic's street address (14 Nov 2026), and the placeholder seeded before it was known.
export const CLINIC_ADDRESS = '23 Montasser St, Al Huwaiteyah, Agouza, Giza Governorate 3753701';
export const OLD_ADDRESS = 'Giza · الجيزة';
/** The address the owner page and the collar tag page show: the street address while the settings hold the placeholder. */
export const clinicAddress = (v) => (typeof v !== 'string' || !v.trim() || v.trim() === OLD_ADDRESS ? CLINIC_ADDRESS : v);
