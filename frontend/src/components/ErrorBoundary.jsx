import { Alert, AlertTitle, Button } from '@mui/material'
import { Component } from 'react'

/** Catches a crash while rendering a screen and offers a way out, instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Screen crashed', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Alert severity="error" role="alert" sx={{ m: 2 }}
        action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>Reload</Button>}>
        <AlertTitle>Something went wrong on this screen</AlertTitle>
        Reload the page, or pick another section from the menu.
      </Alert>
    )
  }
}
