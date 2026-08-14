import type { FaqEntry } from "./json-ld";

/**
 * Single source of truth for the home-page FAQ.
 *
 * Both the visible `<HomeFaq />` section and the `FAQPage` JSON-LD read
 * from this array, because Google requires that every marked-up answer
 * appear verbatim in the rendered page — markup describing text that
 * isn't on screen is a structured-data violation, not a shortcut. Two
 * hand-maintained copies would drift; one shared const cannot.
 *
 * Keep answers as plain strings (no JSX, no markdown). The component
 * renders them as-is so the DOM text and the `acceptedAnswer.text`
 * string are byte-identical.
 *
 * Content choice: these are written against the queries a person
 * actually types when they land near us — including the explicit
 * "is this the Belgian company?" disambiguation at the end, which
 * is still the highest-value question for brand collision (see
 * `organizationJsonLd`'s `disambiguatingDescription`) but sits last
 * so product questions lead the list.
 */
export const HOME_FAQ: readonly FaqEntry[] = [
  {
    question: "What is Materialize?",
    answer:
      "Materialize is an online marketplace for 3D-print files with on-demand 3D printing built in. You can browse and buy printable models from independent creators, upload your own designs to sell, or send any model straight to a vetted print shop and have the finished part shipped to you.",
  },
  {
    question: "Do I need my own 3D printer to use Materialize?",
    answer:
      "No. Upload an STL, OBJ, 3MF or STEP file, pick a material and finish, and you get live pricing from a network of vetted manufacturing partners. The part is printed, quality-checked and shipped to your door, so you never touch a printer.",
  },
  {
    question: "What materials can I get my model 3D printed in?",
    answer:
      "More than 60 materials and finishes, spanning everyday plastics like PLA, PETG, ABS and nylon, resins including multicolor and high-detail options, and metals such as stainless steel, aluminium and titanium. Available finishes and colors are shown for each material when you request a quote.",
  },
  {
    question: "How much does it cost to 3D print a model?",
    answer:
      "Print cost depends on the model's size, the material and the manufacturer you choose, so you see a live quote before you commit rather than an estimate. Materialize adds a 3% service fee on print orders, with a 99-cent minimum and a $5 cap, and passes material and shipping costs through unchanged.",
  },
  {
    question: "What 3D file formats does Materialize support?",
    answer:
      "STL, OBJ, 3MF and STEP files are supported for both printing and marketplace listings. STL and 3MF are the most common exports from slicers and mesh tools, while STEP preserves the parametric solid geometry that CAD applications produce.",
  },
  {
    question: "Can I sell my own 3D models on Materialize?",
    answer:
      "Yes. Publish your models, set a price or release them for free, and earn on every download and print. There are no listing fees and no markup taken from your download revenue.",
  },
  {
    question: "Can an AI agent place a print order on Materialize?",
    answer:
      "Yes. Materialize runs a Model Context Protocol server that lets an authenticated agent search the catalog, upload a model, request a quote and place a print order on your behalf. Spending policies cap what an agent can order, and any order outside policy falls back to email confirmation before it is charged.",
  },
  {
    question: "Is Materialize the same company as Materialise or i.materialise?",
    answer:
      "No. Materialize (materialize.cc) is an independent 3D-print marketplace and printing service, and is not affiliated with Materialise NV or i.materialise, with the Materialize streaming database, or with the Materialize CSS framework. The names are similar; the companies are unrelated.",
  },
] as const;
