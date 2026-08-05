/**
 * Exemplar-farm prompt bank: one entry per PART CLASS the catalog should
 * cover. Biased deliberately toward classes the authored catalog (29
 * entries, enclosure-heavy) does NOT cover — the farm's job is breadth.
 *
 * Prompts are written like good user prompts (concrete dims, function
 * first) because farmed exemplars teach the model what "good" looks like
 * for exactly these shapes; keywords feed selectExemplars retrieval.
 */

export interface FarmClass {
  /** Kebab id — becomes the exemplar id (farm_<id>) on promotion. */
  id: string;
  title: string;
  prompt: string;
  keywords: string[];
}

export const FARM_CLASSES: FarmClass[] = [
  // --- everyday desk/home objects -----------------------------------------
  {
    id: "phone_stand",
    title: "Adjustable-angle phone stand",
    prompt:
      "A desk phone stand holding a phone at 60°: 80 mm wide cradle with a 12 mm lip, cable slot in the base, weighted footprint so it doesn't tip when tapped.",
    keywords: ["phone", "stand", "dock", "cradle", "tablet"],
  },
  {
    id: "headphone_hook",
    title: "Under-desk headphone hook",
    prompt:
      "An under-desk headphone hook: 30 mm wide saddle with smooth 20 mm radius so the headband doesn't crease, screw-mount plate with two M4 counterbored holes.",
    keywords: ["hook", "headphone", "hanger", "under-desk", "holder"],
  },
  {
    id: "wall_hook_heavy",
    title: "Heavy-duty wall hook",
    prompt:
      "A wall hook for a 5 kg backpack: 60 mm reach J-profile with a thick gusseted root, two countersunk M4 screw holes, no sharp edges.",
    keywords: ["hook", "wall", "hanger", "coat", "backpack"],
  },
  {
    id: "cable_clip",
    title: "Snap-in desk cable clip",
    prompt:
      "A desk-edge cable clip for three 4 mm cables: C-clamp that grips a 25 mm desk edge without screws, three rounded cable channels on top, printable flat.",
    keywords: ["cable", "clip", "organizer", "wire", "management", "clamp"],
  },
  {
    id: "pen_cup",
    title: "Weighted hex pen cup",
    prompt:
      "A hexagonal pen cup, 80 mm across flats, 100 mm tall, 2.4 mm walls, slightly tapered outward at the top, ring of drainage/dust holes in the floor.",
    keywords: ["pen", "cup", "holder", "desk", "pencil", "organizer"],
  },
  {
    id: "coaster_set",
    title: "Stackable drink coaster",
    prompt:
      "A 95 mm round drink coaster with a raised 3 mm rim to catch condensation, subtle concentric surface texture for grip, stacking registration lip underneath.",
    keywords: ["coaster", "drink", "cup", "stackable"],
  },
  {
    id: "soap_dish",
    title: "Draining soap dish",
    prompt:
      "A soap dish 110 × 75 mm with angled drainage ribs, a hidden runoff channel to one corner spout, rounded everything, no water traps.",
    keywords: ["soap", "dish", "bathroom", "drain", "tray"],
  },
  {
    id: "key_bowl",
    title: "Entry key bowl",
    prompt:
      "A shallow entryway key bowl, 140 mm diameter, smooth lofted profile from a 90 mm flat base, 2.8 mm walls, interior fillets so contents slide to center.",
    keywords: ["bowl", "key", "tray", "entry", "catch-all", "dish"],
  },

  // --- mounts / brackets / fixtures ---------------------------------------
  {
    id: "camera_mount_quarter20",
    title: "1/4-20 camera shelf mount",
    prompt:
      "A shelf-edge camera mount: clamps a 18-30 mm shelf lip with a screw-less wedge, top boss for a 1/4-20 captive hex nut pocket (11.2 mm across flats, 5.5 mm deep), 45° gusset.",
    keywords: ["camera", "mount", "tripod", "clamp", "webcam"],
  },
  {
    id: "monitor_riser_foot",
    title: "Monitor riser foot",
    prompt:
      "One foot of a monitor riser: 60 mm tall column with 15° splay, 80 mm round base pad, top saddle accepting a 18 mm plywood shelf with two screw pilot bores.",
    keywords: ["riser", "foot", "monitor", "leg", "support", "stand"],
  },
  {
    id: "din_rail_clip",
    title: "DIN-rail mounting clip",
    prompt:
      "A 35 mm DIN-rail clip: sprung lower jaw with a flex slot, rigid upper hook, 40 × 40 mm device plate with four M3 heat-set bosses on a 30 mm square pattern.",
    keywords: ["din", "rail", "clip", "mount", "electrical", "panel"],
  },
  {
    id: "shelf_bracket",
    title: "Ribbed shelf bracket",
    prompt:
      "A 150 × 100 mm shelf bracket with a triangulated web of three ribs, 4 mm wall sections, three countersunk M4 wall holes and two shelf holes, print-flat orientation.",
    keywords: ["bracket", "shelf", "support", "angle", "rib"],
  },
  {
    id: "broom_holder",
    title: "Spring-grip broom holder",
    prompt:
      "A wall broom holder gripping 22-28 mm handles: two flexing fingers with rolled tips, entry chamfer, single central countersunk M5 mount, printable without supports.",
    keywords: ["broom", "holder", "grip", "wall", "tool", "handle"],
  },

  // --- mechanical / functional --------------------------------------------
  {
    id: "spur_gear_pair",
    title: "Printable spur gear",
    prompt:
      "A module-2 spur gear, 20 teeth, 8 mm bore with a 2 mm keyway flat, 10 mm face width, webbed body with four lightening holes and a 16 mm hub.",
    keywords: ["gear", "spur", "teeth", "cog", "transmission"],
  },
  {
    id: "knurled_thumbscrew",
    title: "Knurled thumbscrew knob",
    prompt:
      "A knurled knob for an M6 hex bolt: 32 mm diameter, straight knurl of 24 grooves, hex pocket capturing a 10 mm across-flats bolt head, domed top.",
    keywords: ["knob", "thumbscrew", "knurl", "grip", "bolt"],
  },
  {
    id: "living_hinge_box",
    title: "Living-hinge glasses case",
    prompt:
      "A one-print glasses case 160 × 70 × 40 mm using a living hinge (12 straps, 0.5 mm thick, 1.2 mm gap), snap closure lip, rounded shell body.",
    keywords: ["hinge", "living", "case", "flex", "glasses", "clamshell"],
  },
  {
    id: "carabiner_clip",
    title: "Utility carabiner",
    prompt:
      "A non-load-bearing utility carabiner 70 mm long: flexing gate with a 1.4 mm living-spring root, thumb ramp, closed D-body with 6 mm thick oval section.",
    keywords: ["carabiner", "clip", "gate", "keychain", "snap"],
  },
  {
    id: "hose_adapter",
    title: "Stepped hose adapter",
    prompt:
      "A vacuum hose adapter stepping 35 mm ID down to 25 mm OD over 60 mm, three sealing ridges on each end, internal stop flange, 2.4 mm walls.",
    keywords: ["hose", "adapter", "vacuum", "coupler", "reducer", "fitting"],
  },
  {
    id: "funnel_collapsproof",
    title: "Wide-mouth workshop funnel",
    prompt:
      "A workshop funnel: 120 mm mouth to a 15 mm spout over 100 mm, 60° wall angle, three internal anti-glug ribs, hang tab, 2 mm walls printable without supports.",
    keywords: ["funnel", "pour", "workshop", "spout"],
  },

  // --- organizers / storage ------------------------------------------------
  {
    id: "battery_dispenser_aa",
    title: "Gravity AA battery dispenser",
    prompt:
      "A wall AA battery dispenser holding 12 cells: gravity-fed serpentine channel (14.7 mm bore), pick opening at the bottom with a retaining lip, two screw tabs.",
    keywords: ["battery", "dispenser", "aa", "storage", "holder"],
  },
  {
    id: "sd_card_tray",
    title: "SD + microSD card tray",
    prompt:
      "A desktop card tray: 6 angled SD slots (25 × 3 mm) and 8 microSD slots (12 × 1.6 mm) in two ranks, labels embossed, one-piece with a low center of mass.",
    keywords: ["sd", "card", "tray", "holder", "memory", "organizer"],
  },
  {
    id: "drawer_divider",
    title: "Adjustable drawer divider",
    prompt:
      "A drawer divider tee: 120 mm blade with dovetail feet sliding into a 12 mm rail profile, finger-pull cutout, 2 mm walls with a stiffening flange.",
    keywords: ["drawer", "divider", "organizer", "dovetail", "kitchen"],
  },
  {
    id: "spice_shelf",
    title: "Tiered spice shelf",
    prompt:
      "A two-tier in-cabinet spice riser 220 mm wide: 40 mm and 80 mm steps with 8 mm retaining lips, open back, side walls lofted into a clean swoosh.",
    keywords: ["spice", "shelf", "riser", "tier", "kitchen", "rack"],
  },

  // --- threads (the class that melted the harness) ------------------------
  {
    id: "threaded_jar",
    title: "Threaded storage jar",
    prompt:
      "A 60 mm diameter storage jar with a matching screw lid: chunky external trapezoidal thread on the jar neck (pitch 4 mm), knurled lid gripping band, 2.4 mm walls, parts dict with jar and lid.",
    keywords: ["jar", "thread", "lid", "screw", "container", "threaded"],
  },
  {
    id: "threaded_hook_m12",
    title: "Screw-in utility hook",
    prompt:
      "A screw-in hook with a chunky M12-style external thread (16 mm long) transitioning through a 20 mm hex flange into a 40 mm rounded J-hook, all one solid.",
    keywords: ["hook", "thread", "screw", "threaded", "m12"],
  },

  // --- lighting / decor ----------------------------------------------------
  {
    id: "pendant_shade",
    title: "Ribbed pendant lampshade",
    prompt:
      "A pendant lampshade: 180 mm diameter lofted bell with 24 external ribs, 40 mm top collar with three bayonet tabs for an E26 socket ring, 1.6 mm translucent walls.",
    keywords: ["lamp", "shade", "pendant", "light", "lampshade"],
  },
  {
    id: "planter_selfwater",
    title: "Self-watering planter",
    prompt:
      "A 120 mm self-watering planter: inner pot with wicking slots and a ledge, outer reservoir with a side fill spout and window notch, gentle lofted silhouette, parts dict with pot and reservoir.",
    keywords: ["planter", "pot", "plant", "self-watering", "vase", "reservoir"],
  },
  {
    id: "vase_twisted",
    title: "Twisted facet vase",
    prompt:
      "A 200 mm tall vase: hexagonal cross-section twisted 90° over its height, lofted taper 90 mm base to 60 mm mouth, 2 mm walls, watertight floor.",
    keywords: ["vase", "twist", "decor", "spiral", "flower"],
  },

  // --- tools / jigs ---------------------------------------------------------
  {
    id: "sanding_block",
    title: "Ergonomic sanding block",
    prompt:
      "A palm sanding block for quarter sheets: 110 × 70 mm pad with two spring-loaded paper claws, domed palm swell 35 mm high, finger scallops both sides.",
    keywords: ["sanding", "block", "tool", "grip", "woodworking", "jig"],
  },
  {
    id: "dowel_jig",
    title: "Dowel drilling jig",
    prompt:
      "A corner dowel jig for 18 mm board: fence on two faces, three hardened-sleeve bores at 8 mm (with 0.2 mm press-fit clearance), clamp ear, embossed size label.",
    keywords: ["jig", "dowel", "drill", "guide", "woodworking"],
  },
  {
    id: "zip_tie_gun_handle",
    title: "Flush-cut tool handle",
    prompt:
      "A slide-on comfort handle for flush cutters: 90 mm ergonomic loop with a 22 × 12 mm oval tool pocket, 3 mm walls, finger stop, lanyard hole.",
    keywords: ["handle", "grip", "tool", "cutter", "ergonomic"],
  },

  // --- electronics adjacent (non-enclosure) --------------------------------
  {
    id: "raspi_din_carrier",
    title: "PCB edge carrier rails",
    prompt:
      "A pair of PCB carrier rails for a 65 × 30 mm board: 1.7 mm edge slots, end stops, snap nubs, joined by a sacrificial break-away bridge for one-print convenience.",
    keywords: ["pcb", "rail", "carrier", "board", "slot", "electronics"],
  },
  {
    id: "cable_spool",
    title: "Split-flange cable spool",
    prompt:
      "A hand cable spool for 10 m of cord: 80 mm drum, 130 mm flanges with a cord keeper notch in each, 25 mm center grip bore, generous fillets everywhere.",
    keywords: ["spool", "cable", "cord", "reel", "winder"],
  },
  {
    id: "usb_dock_weight",
    title: "Weighted USB hub cradle",
    prompt:
      "A cradle holding a 100 × 40 × 12 mm USB hub at 15°: wrap-around lips, rear cable channel, hollow base chamber for ballast with a sliding lid, parts dict.",
    keywords: ["usb", "hub", "cradle", "dock", "holder", "weighted"],
  },

  // --- wearable / personal --------------------------------------------------
  {
    id: "watch_stand",
    title: "Watch charging stand",
    prompt:
      "A watch charging stand: 45° T-bar for the strap, 32 mm through-bore seating a round inductive puck (28.5 mm, 0.3 mm clearance), rear cable channel, lofted base.",
    keywords: ["watch", "stand", "charger", "dock", "apple watch"],
  },
  {
    id: "badge_reel_clip",
    title: "ID badge holder clip",
    prompt:
      "A rigid ID badge holder for 86 × 54 mm cards: open-face frame with corner keeps and a thumb slide slot, integrated belt-clip spring arm on the back, one print.",
    keywords: ["badge", "id", "holder", "clip", "card", "belt"],
  },
];
