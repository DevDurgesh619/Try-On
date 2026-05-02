// 1x1 PNG used as a stand-in result when settings.use_placeholder_images is true.
// Lets contributors run the full UI flow without burning Gemini credits.
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export const PLACEHOLDER_RESULT_DATA_URL = `data:image/png;base64,${ONE_PX_PNG_BASE64}`;

export function makePlaceholderResult(): { full_data_url: string; thumbnail_data_url: string } {
  return {
    full_data_url: PLACEHOLDER_RESULT_DATA_URL,
    thumbnail_data_url: PLACEHOLDER_RESULT_DATA_URL,
  };
}
