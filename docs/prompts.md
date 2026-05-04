# Gemini Prompt Templates

These are the prompts sent to Nano Banana 2 (`gemini-3.1-flash-image-preview`) for each mode. **Do not invent your own prompts in code.** Import from `extension/src/lib/prompts.ts`, which mirrors this file. If a prompt needs to change, update this file first, then sync the code.

## Why these are written the way they are
- Nano Banana 2 takes multiple input images. The order matters: we always put the **reference photo first** and the **source/garment image second**, then a text instruction.
- The prompt explicitly tells the model what to keep (the user's identity, body, face, lighting context) and what to change (only the named element).
- Identity preservation is the most-failed step. We over-emphasize it.
- We avoid prompt-injecting brand names from product titles — Nano Banana 2 has world knowledge and may hallucinate brand-specific styling.

---

## Mode 1 — Outfit Try-On (garment slots)

Mode 1 supports up to 2 garment slots. Each slot has a `slot` label of `top`, `bottom`, or `full`. Valid combinations:
- Exactly **1** garment of any slot type, **or**
- Exactly **2** garments where one is `top` and one is `bottom`.

The reference photo is always the first image. Source images follow in canonical order: for 2-slot, **top before bottom**. The text prompt selected depends on the combination.

### OUTFIT_FULL_PROMPT — 1 source, the whole outfit

Inputs:
1. Reference photo: full-body photo of the user
2. Source image: a model wearing both top and bottom (or a flat-lay showing a complete outfit)

```
You are an expert virtual try-on system.

The first image shows the PERSON. The second image shows a COMPLETE OUTFIT, possibly worn by a different model or shown as a flat-lay.

Your task: produce a single photorealistic image of the PERSON from the first image wearing every clothing item from the second image — both the top (e.g. shirt, t-shirt, kurta) and the bottom (e.g. trousers, jeans, joggers, skirt) — and any other clothing visible on the model.

Strict requirements:
- The person's face, hair, skin tone, body shape, height, and proportions must remain exactly as in the first image. Do not alter their identity in any way.
- Replace the person's existing clothing with the outfit from the second image. Keep accessories (watches, glasses, bag) and the background unchanged from the first image.
- Each garment should drape naturally on the person's body, with realistic fit, folds, and shadows.
- Match the lighting and color temperature of the first image so the result looks like a real photograph of that person.
- Preserve every garment's true color, pattern, print, texture, and any visible logos or details from the second image.
- The output must be a single image. Do not return text.
```

### OUTFIT_TOP_PROMPT — 1 source, top only

Inputs:
1. Reference photo: full-body photo of the user
2. Source image: a top (shirt, t-shirt, kurta, etc.) — on a model or flat-lay

```
You are an expert virtual try-on system.

The first image shows the PERSON. The second image shows a TOP GARMENT (e.g. shirt, t-shirt, kurta, blouse, sweater), possibly worn by a different model or shown as a flat-lay.

Your task: produce a single photorealistic image of the PERSON from the first image wearing the TOP from the second image — and ONLY the top.

Strict requirements:
- The person's face, hair, skin tone, body shape, height, and proportions must remain exactly as in the first image. Do not alter their identity in any way.
- Replace ONLY the upper-body garment on the person with the top from the second image.
- The person's existing bottom (pants, jeans, joggers, shorts, skirt) from the first image must remain completely unchanged — same color, fit, length, and details. Do NOT swap or restyle the bottom under any circumstances.
- Accessories and the background from the first image must remain unchanged.
- The top should drape naturally on the person's body, with realistic fit, folds, and shadows.
- Match the lighting and color temperature of the first image so the result looks like a real photograph of that person.
- Preserve the top's true color, pattern, print, texture, and any visible logos or details from the second image.
- The output must be a single image. Do not return text.
```

### OUTFIT_BOTTOM_PROMPT — 1 source, bottom only

Inputs:
1. Reference photo: full-body photo of the user
2. Source image: a bottom (jeans, trousers, joggers, skirt, etc.) — on a model or flat-lay

```
You are an expert virtual try-on system.

The first image shows the PERSON. The second image shows a BOTTOM GARMENT (e.g. jeans, trousers, joggers, shorts, skirt), possibly worn by a different model or shown as a flat-lay.

Your task: produce a single photorealistic image of the PERSON from the first image wearing the BOTTOM from the second image — and ONLY the bottom.

Strict requirements:
- The person's face, hair, skin tone, body shape, height, and proportions must remain exactly as in the first image. Do not alter their identity in any way.
- Replace ONLY the lower-body garment on the person with the bottom from the second image.
- The person's existing top (shirt, t-shirt, kurta, sweater, jacket) from the first image must remain completely unchanged — same color, fit, length, sleeves, and details. Do NOT swap or restyle the top under any circumstances.
- Accessories and the background from the first image must remain unchanged.
- The bottom should drape naturally on the person's body, with realistic fit, folds, and shadows.
- Match the lighting and color temperature of the first image so the result looks like a real photograph of that person.
- Preserve the bottom's true color, pattern, print, texture, and any visible logos or details from the second image.
- The output must be a single image. Do not return text.
```

### OUTFIT_TOP_AND_BOTTOM_PROMPT — 2 sources, top + bottom

Inputs:
1. Reference photo: full-body photo of the user
2. Top source image
3. Bottom source image

```
You are an expert virtual try-on system handling a two-garment composition.

The first image shows the PERSON. The second image shows the TOP GARMENT (e.g. shirt, t-shirt, kurta) to apply. The third image shows the BOTTOM GARMENT (e.g. jeans, trousers, joggers, skirt) to apply.

Your task: produce a single photorealistic image of the PERSON from the first image wearing the TOP from the second image and the BOTTOM from the third image, combined into one coherent outfit.

Strict requirements:
- The person's face, hair, skin tone, body shape, height, and proportions must remain exactly as in the first image. Do not alter their identity in any way.
- Apply the top from the second image to the person's upper body, replacing whatever they were wearing on top.
- Apply the bottom from the third image to the person's lower body, replacing whatever they were wearing below.
- Do not mix elements between the two source images: the top must come strictly from image 2, the bottom strictly from image 3.
- Accessories and the background from the first image must remain unchanged.
- Both garments should drape naturally on the person's body, with realistic fit, folds, and shadows, and look coherent together as a single outfit.
- Match the lighting and color temperature of the first image so the result looks like a real photograph of that person.
- Preserve each garment's true color, pattern, print, texture, and any visible logos or details from its source image.
- The output must be a single image. Do not return text.
```

### Accessories clauses (appended to any of the four prompts above)

Mode 1 has an `accessoriesMode` flag with three values: `'off'` (default), `'model'`, and `'custom'`. The base prompt is left unchanged for `'off'`. For the other two modes, append one of the clauses below as a new paragraph **before** the final "The output must be a single image" line of the base prompt.

#### ACCESSORY_FROM_MODEL_CLAUSE — applied when `accessoriesMode = 'model'`

```
Additionally, transfer any accessories visible on the source model(s) — including watches, bracelets, glasses, sunglasses, belts, bags, jewelry, hats, scarves, and ties — onto the person from the first image. Place each accessory naturally where it would normally be worn (watch on wrist, glasses on face, belt at waist, etc.). This rule overrides any earlier instruction to keep accessories from the first image unchanged: when the source model is wearing accessories, those accessories take priority and replace the user's accessories of the same type.
```

#### ACCESSORY_FROM_IMAGE_CLAUSE — applied when `accessoriesMode = 'custom'`

When this clause is used, **one or more accessory images** are appended to the request after the garment images. The clause is phrased to handle 1+ accessories.

```
Additionally, after the garment image(s), every remaining image in this request shows an ACCESSORY ITEM (e.g. a watch, glasses, belt, bag, hat, jewelry, scarf). Apply each accessory to the person from the first image, placing each one naturally where it would normally be worn (watch on wrist, glasses on face, belt at waist, etc.). Preserve every accessory's true color, material, shape, and any visible logos or details. This rule overrides any earlier instruction to keep accessories from the first image unchanged: when an accessory image is provided, that accessory takes priority over the user's accessory of the same type.
```

The clause is inserted **immediately before** the line "The output must be a single image. Do not return text." — never at the very end, so the model still gets the single-image instruction last.

### HAIR_IN_OUTFIT_CLAUSE — appended when an outfit try-on also includes a hairstyle reference

Mode 1 has an optional `outfit_hair_source` input — a haircut reference that arrives alongside the outfit (e.g. user picks a top from Myntra and a hairstyle from a Pinterest pin). When present, the hair source is sent as the **LAST** image in the request so the existing accessory clause's "every image after the garments is an accessory" wording still works for accessories. The hair clause then explicitly carves the last image out of the accessory rule.

The clause below is inserted **immediately before** the final "The output must be a single image. Do not return text." line, and **after** any accessory clause if both are present.

The Outfit pipeline is a convenience surface for hair — the dedicated Hair tab (Mode 2) with a face-only reference photo remains the higher-quality path, and the side panel UI nudges users toward it. The clause therefore has to do most of the heavy lifting that `HAIR_PROMPT` does, but condensed so the combined prompt does not become unwieldy.

```
Additionally, this request changes the user's hairstyle as well as their outfit. The earlier instruction to "keep the user's hair exactly as in the first image" is overridden — but ONLY for the hair on the head. Every other preserved element (face, facial features, expression, skin tone, body, beard / mustache / facial hair, jewelry, background, and the clothing rules above) still applies in full.

The LAST image in this request is a STYLE REFERENCE for the haircut. It is NOT a garment and NOT an accessory — do not place it on the body. Use it ONLY as a guide to the SHAPE of the cut.

Take from the last image: the cut, length, layering, silhouette, parting, fringe / bangs shape, how the hair sits around the ears and neckline, the styling (straight, wavy, curly, slicked, tousled, etc.), and the relative volume.

Do NOT take from the last image: its pixel colors, exposure, brightness, contrast, white balance, ambient color cast, highlight placement, specular shine, shadow direction, image grain, or the reference person's skin / scalp / head shape.

Re-render the new hair from scratch as if it were freshly photographed on the user, in the user's first-image scene, under the user's first-image lighting, at the user's first-image exposure. Every strand's brightness, every highlight, every shadow must be derived from the first image's lighting environment, never from the last image's. Match the photographic sharpness and grain of the first image.

Hair color: keep the user's own natural hair color from the first image as the base tone. Do NOT dye their hair just because the reference person has a different color. The only exception is when the reference style is defined by a clearly non-natural color treatment (e.g. obvious bleach blonde, dyed pink) that is plainly part of the style intent — in that case apply the treatment, but still relight it to match the first image.

The new hair must conform to the user's actual head shape and hairline — drape it on their head, do not graft on the reference person's scalp. If the style includes a fringe or bangs, place them naturally over the user's forehead and re-light them onto the forehead; do not redraw the forehead skin, eyebrows, or eyes underneath.

Final check: the output must look like a single photograph of the user, taken in the same lighting as their reference photo, after a real haircut and outfit change in one sitting — not a composite.
```

---

## Mode 2 — Hairstyle Try-On (v1: hair only)

Inputs (in this order):
1. Reference photo: face photo of the user (a `full_body` reference also works but face-only gives the model less to misinterpret).
2. Source image: a hairstyle reference — celebrity photo, hairstylist gallery, magazine still, image-search result. Anything where the hair is clearly visible.

v1 ships **`HAIR_PROMPT`** below. Beard / mustache support and the `target` flag from earlier drafts are deferred — see `docs/decisions.md` D12.

### HAIR_PROMPT

```
You are an expert virtual hairstyle try-on system. Your job is closer to a hairstylist re-cutting and re-styling the person's own hair than to pasting a wig from another photo.

The first image shows the PERSON. The second image is a STYLE REFERENCE — use it ONLY as a guide to the SHAPE of the haircut. It is not a source of pixels.

Your task: produce a single photorealistic image of the PERSON from the first image, re-cut and re-styled to match the SHAPE of the hairstyle in the second image — as if the person walked into a salon, the stylist cut their hair to that shape, and we then photographed them again under the exact same lighting as the first image.

Strict identity preservation (highest priority — never break):
- The person's face, facial features, skin tone, eye color, eyebrow shape and color, nose, lips, ears, jawline, cheekbones, neck, and overall head shape must remain pixel-perfect identical to the first image. Do not redraw the face.
- The person's facial expression — eye gaze direction, mouth position, smile, micro-expressions — must remain exactly as in the first image.
- Do NOT modify the beard, mustache, stubble, or any facial hair. Leave every facial-hair pixel exactly as in the first image.
- Do NOT modify the clothing, accessories, jewelry, or background from the first image.

Take ONLY THESE traits from the second image (the geometry of the cut):
- The cut, length, layering, and overall silhouette of the hair.
- The parting (side, middle, none) and where the hair flows from.
- The styling: how the hair is brushed, swept, curled, or textured (e.g. straight, wavy, curly, coily; slicked, tousled, blown out).
- The presence and shape of fringe / bangs, sideburns line, neckline cut, and how the hair sits around the ears.
- The relative volume and density distribution.

Do NOT take any of these from the second image (these come from the first image, always):
- Photographic exposure, brightness, contrast, white balance, or color temperature.
- Highlight placement, specular shine, rim light, fill light, or shadow direction.
- The ambient color cast (warm indoor, cool daylight, golden hour, fluorescent, etc.).
- The skin tone or complexion of the reference person — the user's own skin tone never changes.
- The reference person's head shape, hairline geometry, ears, scalp, or face.

Hair color and rendering (this is where most failures happen — read carefully):
- Treat the second image as a black-and-white shape diagram, NOT a color sample. Do not copy its pixel colors, its highlights, or its shadow shapes onto the user's head.
- The hair must be RE-RENDERED FROM SCRATCH as if it were freshly photographed on the user, in the same scene, under the same light source(s), at the same camera exposure as the first image. Every strand's brightness, every highlight, every shadow must be derived from the first image's lighting environment, not the second image's.
- For hair color: keep the user's own natural hair color from the first image as the base tone (this is critical — do not dye their hair just because the reference person has a different color). Apply the cut and style to the user's existing hair color. The only exception: if the reference style is defined by a clearly non-natural color treatment (e.g. obvious bleach blonde, dyed pink) and that treatment is plainly part of the style intent, you may apply it — but still relight it to match the first image.
- The new hair must look like it belongs in the first photograph. If the first image has soft window light from the left, the new hair shows soft highlights on the left and falls into shadow on the right. If the first image is dim and warm, the new hair is dim and warm. The new hair must NOT carry over the studio shine, flash, or color cast of the second image.
- Match individual strand sharpness and image grain to the first image's photographic quality. If the first image is slightly soft, do not paint razor-sharp strands; if it is sharp, render crisp strands.
- If the reference style includes a fringe or bangs, place them naturally over the person's forehead and re-light them onto the forehead; do not redraw the forehead skin, eyebrows, or eyes underneath.
- The hair must conform to the user's actual head shape and hairline from the first image — drape it on their head, do not graft on the reference person's scalp.

Sanity check before finalizing:
- Could a stranger look at the output and the first image side by side and believe both are real photographs of the same person, taken in the same room minutes apart, with only a haircut in between? If not, fix the lighting on the new hair until they could.

The output must be a single photorealistic image. Do not return text.
```

### Deferred (do not use yet)

A future `BEARD_PROMPT` will mirror `HAIR_PROMPT` for facial hair, and a `HAIR_AND_BEARD_PROMPT` will combine both. Wiring exists in the `Mode` enum (`'hair'`) but the backend rejects any mode other than `'outfit'` or `'hair'` in v1.

---

## BLEND_PROMPT (Mode 3)

Inputs (variable, in this order):
1. Reference photo: full-body photo of the user
2. Source image A + label
3. Source image B + label
4. (Up to N more)

The text prompt is built dynamically:

```
You are an expert virtual try-on system handling a multi-element composition.

The first image shows the PERSON. The following images each contribute one element to a combined look:
{for each source image, append: "- Image {n}: take the {label} from this image"}

Your task: produce a single photorealistic image of the PERSON from the first image with all of the above elements applied together.

Strict requirements:
- The person's face, body shape, height, proportions, and skin tone must remain exactly as in the first image. Do not alter their identity.
- Apply each element from its respective source image to the person, replacing the corresponding element on them.
- Elements must combine naturally — the outfit must look coherent on a single body, the hair must sit correctly on the head, etc.
- Match the lighting and color temperature of the first image. The result must look like a real photograph of that person.
- Background from the first image must remain unchanged.
- The output must be a single image. Do not return text.

User-supplied creative direction (optional): {user_extra_prompt}
```

If the user provided no extra prompt, omit the last line entirely.

---

## Things we tried and removed (do not re-add)
- "Use a high-end fashion photography style" — caused the model to alter the user's face to look more "fashion-y."
- "Make sure the lighting is studio quality" — same issue.
- Listing the brand name in the prompt — caused hallucinated styling that didn't match the actual product.
- Asking for "multiple angles" — the model collapses these into a collage; we don't want that. Single image only.
