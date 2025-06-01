import { useSelector } from 'react-redux'
import type { RootState } from '../store'

export const useProfiles = () => {
  const { items: profiles, loading, error, selectedProfile } = useSelector((state: RootState) => state.profiles)
  return { profiles, loading, error, selectedProfile }
} 