/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_SOCKET_URL: string
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {
  const content: { [className: string]: string }
  export default content
}

declare module '*.scss' {
  const content: { [className: string]: string }
  export default content
}

declare module '*.sass' {
  const content: { [className: string]: string }
  export default content
}

declare module '*.less' {
  const content: { [className: string]: string }
  export default content
}

declare module '*.styl' {
  const content: { [className: string]: string }
  export default content
}
