// Everything that changes from year to year lives here.
// Edit this file (and the schedule/speakers text in public/index.html) for next year's conference.

export const EVENT = {
  name: 'Bagdad Mini-Conference 2026',
  org: 'Bagdad Retreat Inc',
  dates: 'November 6–7, 2026',
  place: 'Relevant Church, Carrollton, KY',
  // Online registration and T-shirt orders close at the end of October 30, Eastern time.
  closesAt: '2026-10-31T04:00:00Z',
  closesLabel: 'October 30',
  doorPrice: 35,
  lodgingCode: '7502',
  lodgingPhone: '(502) 732-4384',
  lodgingUrl: 'https://parks.ky.gov/explore/general-butler-state-resort-park-7789',
  contactEmail: 'BagdadAA@Outlook.com',
  checkIn: 'Friday 3:00–5:00 pm or 7:30–8:00 pm',
};

// Dollars.
export const PRICES = {
  registration: 30,
  shirt: 30,
};

export const SHIRTS = [
  {
    id: 'odaat',
    name: 'One Day at a Time',
    tagline: 'Front: “Still Here” · Back: “One Day at a Time”',
    image: '/images/one-day-at-a-time.jpg',
  },
];

export const SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

export const ROLES = ['AA', 'Al-Anon', 'Guest'];

export const LIMITS = {
  people: 10, // per registration
  shirtLines: 20, // distinct design + size lines per registration
  shirtQty: 20, // per line
  donation: 5000, // dollars
};
