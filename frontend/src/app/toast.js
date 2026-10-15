import { createContext, useContext } from 'react'

export const ToastContext = createContext({ success() {}, error() {}, warning() {}, info() {} })

export const useToast = () => useContext(ToastContext)
