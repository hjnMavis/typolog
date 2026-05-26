export const APP_NAME = "Typolog"
export const APP_DESCRIPTION = "같은 문장을, 각자의 일상에서 전혀 다르게 완성하는 글자 콜라주 앱"

export const SLOT_BACKGROUND_COLORS = ["#ffffff", "#1a1a1a", "#f5f0e8"] as const
export type BackgroundColor = (typeof SLOT_BACKGROUND_COLORS)[number]
