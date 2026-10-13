import { createContext, useContext } from 'react'

export const ToastContext = createContext({ success() {}, error() {} })

export const useToast = () => useContext(ToastContext)
