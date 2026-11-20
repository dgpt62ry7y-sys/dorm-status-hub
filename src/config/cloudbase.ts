function requiredConfig(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Create .env.local and configure your own CloudBase environment.`,
    )
  }
  return value
}

export const CLOUDBASE_ENV_ID = requiredConfig(
  'VITE_CLOUDBASE_ENV_ID',
  import.meta.env.VITE_CLOUDBASE_ENV_ID,
)

export const DORMSYNC_API_URL = requiredConfig(
  'VITE_DORMSYNC_API_URL',
  import.meta.env.VITE_DORMSYNC_API_URL,
)
