// Verbatim mirror of docs/prompts.md. Keep in sync with extension/src/lib/prompts.ts.

export const ACCESSORY_FROM_MODEL_CLAUSE = `Additionally, transfer any accessories visible on the source model(s) — including watches, bracelets, glasses, sunglasses, belts, bags, jewelry, hats, scarves, and ties — onto the person from the first image. Place each accessory naturally where it would normally be worn (watch on wrist, glasses on face, belt at waist, etc.). This rule overrides any earlier instruction to keep accessories from the first image unchanged: when the source model is wearing accessories, those accessories take priority and replace the user's accessories of the same type.`;

export const ACCESSORY_FROM_IMAGE_CLAUSE = `Additionally, after the garment image(s), every remaining image in this request shows an ACCESSORY ITEM (e.g. a watch, glasses, belt, bag, hat, jewelry, scarf). Apply each accessory to the person from the first image, placing each one naturally where it would normally be worn (watch on wrist, glasses on face, belt at waist, etc.). Preserve every accessory's true color, material, shape, and any visible logos or details. This rule overrides any earlier instruction to keep accessories from the first image unchanged: when an accessory image is provided, that accessory takes priority over the user's accessory of the same type.`;

export const HAIR_PROMPT = `You are an expert virtual hairstyle try-on system. Your job is closer to a hairstylist re-cutting and re-styling the person's own hair than to pasting a wig from another photo.

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

The output must be a single photorealistic image. Do not return text.`;

export const OUTFIT_FULL_PROMPT = `You are an expert virtual try-on system.

The first image shows the PERSON. The second image shows a COMPLETE OUTFIT, possibly worn by a different model or shown as a flat-lay.

Your task: produce a single photorealistic image of the PERSON from the first image wearing every clothing item from the second image — both the top (e.g. shirt, t-shirt, kurta) and the bottom (e.g. trousers, jeans, joggers, skirt) — and any other clothing visible on the model.

Strict requirements:
- The person's face, hair, skin tone, body shape, height, and proportions must remain exactly as in the first image. Do not alter their identity in any way.
- Replace the person's existing clothing with the outfit from the second image. Keep accessories (watches, glasses, bag) and the background unchanged from the first image.
- Each garment should drape naturally on the person's body, with realistic fit, folds, and shadows.
- Match the lighting and color temperature of the first image so the result looks like a real photograph of that person.
- Preserve every garment's true color, pattern, print, texture, and any visible logos or details from the second image.
- The output must be a single image. Do not return text.`;

export const OUTFIT_TOP_PROMPT = `You are an expert virtual try-on system.

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
- The output must be a single image. Do not return text.`;

export const OUTFIT_BOTTOM_PROMPT = `You are an expert virtual try-on system.

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
- The output must be a single image. Do not return text.`;

export const OUTFIT_TOP_AND_BOTTOM_PROMPT = `You are an expert virtual try-on system handling a two-garment composition.

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
- The output must be a single image. Do not return text.`;
