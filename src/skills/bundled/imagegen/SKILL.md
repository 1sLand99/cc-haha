---
name: imagegen
description: Generate original images, artwork, product visuals, diagrams, or other raster assets with the desktop's configured image provider. Use whenever the user asks to create or generate an image.
allowed-tools: ImageGen
---

# Image generation

Use the built-in `ImageGen` tool. Provider authentication, model routing, output storage, and secrets are managed by the desktop host; never ask the user to put an API key in this skill or in the prompt.

## Decide the request shape

- Treat a brand-new visual as generation. Treat a request that preserves or changes an existing visual as an edit.
- For generation, omit `input_images` entirely. Never pass `/dev/null`, an empty string, or any other placeholder path to represent no input image.
- One distinct prompt equals one tool call.
- Use `count` only for multiple variations of the same prompt. For different concepts, make separate calls.
- For an edit, populate `input_images` with ordered paths surfaced by `[Image source: ...]` in a user attachment or returned by an earlier `ImageGen` call. Never invent, search for, or substitute another filesystem path.
- Label every input image with its role: `edit_target`, `reference`, `style_reference`, or `composite_source`. The first image is the primary canvas unless the user says otherwise.
- For multi-turn editing, use the latest selected output as the next turn's `edit_target`. Repeat all identity, layout, text, and unchanged-region constraints on every turn so edits do not drift.
- To edit several images independently, make one call per image. Put multiple images in one call only when the user wants them combined or used together as references. A single call accepts at most three source images.
- Prefer a useful default composition when the user leaves details open. Do not invent branding, logos, or people they did not request.
- Respect an explicitly requested concrete provider model ID by passing `model`; otherwise omit the field so the configured model is used. Never pass `default` or another placeholder model name.
- If the provider or tool returns an error, do not retry `ImageGen` automatically. Explain the failure and let the user decide whether to retry or change providers.

## Build the prompt

Turn the request into a compact art-direction brief. Include only relevant fields:

- use case and image type
- subject, action, and important attributes
- environment and context
- composition, framing, and camera angle
- lighting and mood
- visual style or medium
- color palette
- exact text, only when text must appear in the image
- constraints and elements to avoid

For edits, start the prompt with each input's numbered role, then say `change only X; keep Y unchanged`. For a composite, specify which subject or visual property comes from each numbered image and preserve the requested identities. Do not rely on conversational pronouns such as "it" or "the previous one" inside the tool prompt.

Preserve the user's intent and wording for names or required on-image text. For diagrams, specify hierarchy, reading order, labels, and connections. For photorealistic work, describe lens, depth of field, lighting direction, and material detail when they matter.

## Output options

- Use `aspect_ratio` when the user describes a layout such as square, portrait, landscape, banner, or phone wallpaper.
- Use `resolution: "2k"` only when higher resolution is useful and supported.
- Use transparent background only when requested or clearly needed for a reusable asset.
- The host displays one placeholder per requested image and replaces each slot as the saved image becomes available.

After a successful call, briefly summarize what was created or changed. The host card already displays and opens the saved images, so do not repeat, link, or embed the returned local paths in the final answer. Do not include base64 data in the conversation.
