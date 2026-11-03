# Owners & pets import sheet

For Dr. Waleed's assistant. One row per **pet**. If an owner has three pets, repeat the owner's name and phone on three rows — rows with the same phone become one owner. An owner with no pets yet: fill the owner columns and leave `pet_name` empty.

Get a ready-made file from the app: **Settings → Data & backup → Download template**. Import it from the same screen (one run on launch day; SCOPE §4).

| Column | Required | Example | Notes |
|---|---|---|---|
| `owner_full_name` | ✔ | Mona Hassan / منى حسن | |
| `owner_phone` | ✔ | 01012345678 | Egyptian mobile; used to merge rows |
| `owner_whatsapp` | | 01012345678 | Empty = same as phone |
| `owner_email` | | mona@example.com | |
| `owner_address` | | Heliopolis, Cairo | |
| `owner_notes` | | Prefers WhatsApp | |
| `pet_name` | | Luna | Empty = owner only |
| `species` | | CAT | DOG, CAT, BIRD, RABBIT, REPTILE, OTHER (or كلب، قطة، طائر، أرنب، زواحف) |
| `breed` | | Persian | |
| `sex` | | FEMALE | MALE / FEMALE (or ذكر / أنثى); empty = unknown |
| `is_neutered` | | yes | yes / no |
| `date_of_birth` | | 2022-05-14 | `YYYY-MM-DD` or `DD/MM/YYYY` |
| `dob_is_estimate` | | yes | yes when the age is a guess |
| `color` | | White | |
| `microchip_no` | | 818000001234567 | Must be unique; duplicates are skipped and listed |
| `pet_notes` | | Allergic to penicillin | |

After the import the app shows how many owners and pets were created and lists any skipped rows by row number. Acceptance check (SCOPE §7.9): imported counts match the sheet's row count.
