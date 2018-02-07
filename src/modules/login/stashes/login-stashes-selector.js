// @flow

import type { ApiInput } from '../../root.js'
import type { LoginStashMap } from './login-stashes-reducer.js'

export function waitForStashes (ai: ApiInput): Promise<LoginStashMap> {
  // The types for `waitFor` are wrong, since it filters out `undefined`:
  const out: any = ai.waitFor(props => {
    if (props.state.login.stashes.stashesLoaded) {
      return props.state.login.stashes.stashes
    }
  })
  return out
}
