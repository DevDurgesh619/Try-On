export type ReferencePhotoType = 'full_body' | 'face';
export type Mode = 'outfit' | 'hair' | 'blend';
export type GarmentSlot = 'top' | 'bottom' | 'full';
export type AccessoriesMode = 'off' | 'model' | 'custom';
export type OutfitType = 'full' | 'split';

export interface PendingGarment {
  slot: GarmentSlot;
  url: string;
  origin: 'auto' | 'hover' | 'context_menu';
}

export interface PendingAccessory {
  url: string;
  origin: 'context_menu' | 'upload' | 'hover';
}

export interface PendingHairSource {
  url: string;
  origin: 'context_menu' | 'upload';
}

export interface ReferencePhoto {
  id: string;
  label: string;
  type: ReferencePhotoType;
  data_url: string;
  created_at: number;
}

export interface RecentResult {
  id: string;
  mode: Mode;
  thumbnail_data_url: string;
  full_data_url: string;
  created_at: number;
}

export interface Settings {
  default_reference_photo_id?: string;
  use_placeholder_images: boolean;
}

export interface StorageShape {
  device_id: string;
  reference_photos: ReferencePhoto[];
  recent_results: RecentResult[];
  settings: Settings;
}

// ---------- Message bus ----------

export interface ListPhotosMsg {
  type: 'LIST_PHOTOS';
}
export interface SavePhotoMsg {
  type: 'SAVE_PHOTO';
  label: string;
  photoType: ReferencePhotoType;
  data_url: string;
}
export interface DeletePhotoMsg {
  type: 'DELETE_PHOTO';
  id: string;
}
export interface OutfitGenerateMsg {
  type: 'GENERATE';
  mode: 'outfit';
  garments: { slot: GarmentSlot; sourceImageUrl: string }[];
  referencePhotoId: string;
  accessoriesMode: AccessoriesMode;
  /** Required (and non-empty) when accessoriesMode === 'custom'. */
  accessoryUrls?: string[];
  seed?: number;
}
export interface HairGenerateMsg {
  type: 'GENERATE';
  mode: 'hair';
  hairSourceUrl: string;
  referencePhotoId: string;
  seed?: number;
}
export type GenerateMsg = OutfitGenerateMsg | HairGenerateMsg;
export interface SourceImageSelectedMsg {
  type: 'SOURCE_IMAGE_SELECTED';
  url: string;
  origin: PendingGarment['origin'];
  /** Optional preferred slot. Defaults to 'full'. */
  slot?: GarmentSlot;
}
export interface AddPendingGarmentMsg {
  type: 'ADD_PENDING_GARMENT';
  garment: PendingGarment;
}
export interface RemovePendingGarmentMsg {
  type: 'REMOVE_PENDING_GARMENT';
  index: number;
}
export interface SetGarmentSlotMsg {
  type: 'SET_GARMENT_SLOT';
  index: number;
  slot: GarmentSlot;
}
export interface GetPendingGarmentsMsg {
  type: 'GET_PENDING_GARMENTS';
}
export interface ClearPendingGarmentsMsg {
  type: 'CLEAR_PENDING_GARMENTS';
}
export interface SetOutfitTypeMsg {
  type: 'SET_OUTFIT_TYPE';
  outfitType: OutfitType;
}
export interface SetAccessoriesModeMsg {
  type: 'SET_ACCESSORIES_MODE';
  mode: AccessoriesMode;
}
export interface AddPendingAccessoryMsg {
  type: 'ADD_PENDING_ACCESSORY';
  accessory: PendingAccessory;
}
export interface RemovePendingAccessoryMsg {
  type: 'REMOVE_PENDING_ACCESSORY';
  index: number;
}
export interface ClearPendingAccessoriesMsg {
  type: 'CLEAR_PENDING_ACCESSORIES';
}
export interface GetTryonStateMsg {
  type: 'GET_TRYON_STATE';
}
export interface SetPendingHairSourceMsg {
  type: 'SET_PENDING_HAIR_SOURCE';
  source: PendingHairSource;
}
export interface ClearPendingHairSourceMsg {
  type: 'CLEAR_PENDING_HAIR_SOURCE';
}
export interface GetHairStateMsg {
  type: 'GET_HAIR_STATE';
}

export type Message =
  | ListPhotosMsg
  | SavePhotoMsg
  | DeletePhotoMsg
  | GenerateMsg
  | SourceImageSelectedMsg
  | AddPendingGarmentMsg
  | RemovePendingGarmentMsg
  | SetGarmentSlotMsg
  | GetPendingGarmentsMsg
  | ClearPendingGarmentsMsg
  | SetOutfitTypeMsg
  | SetAccessoriesModeMsg
  | AddPendingAccessoryMsg
  | RemovePendingAccessoryMsg
  | ClearPendingAccessoriesMsg
  | GetTryonStateMsg
  | SetPendingHairSourceMsg
  | ClearPendingHairSourceMsg
  | GetHairStateMsg;

export interface ListPhotosResponse {
  ok: true;
  photos: ReferencePhoto[];
}
export interface SavePhotoResponse {
  ok: true;
  photo: ReferencePhoto;
}
export interface DeletePhotoResponse {
  ok: true;
}
export interface GenerateResponse {
  ok: true;
  result: RecentResult;
  ms_taken: number;
}
export interface PendingGarmentsResponse {
  ok: true;
  garments: PendingGarment[];
}
export interface TryonStateResponse {
  ok: true;
  outfitType: OutfitType;
  garments: PendingGarment[];
  accessoriesMode: AccessoriesMode;
  accessories: PendingAccessory[];
}
export interface HairStateResponse {
  ok: true;
  source: PendingHairSource | null;
}
export interface ErrorResponse {
  ok: false;
  code:
    | 'unknown_message'
    | 'no_reference_photo'
    | 'source_fetch_failed'
    | 'rate_limited'
    | 'gemini_safety_block'
    | 'gemini_timeout'
    | 'backend_error'
    | 'storage_full';
  message: string;
}

export type MessageResponse =
  | ListPhotosResponse
  | SavePhotoResponse
  | DeletePhotoResponse
  | GenerateResponse
  | PendingGarmentsResponse
  | TryonStateResponse
  | HairStateResponse
  | ErrorResponse;
