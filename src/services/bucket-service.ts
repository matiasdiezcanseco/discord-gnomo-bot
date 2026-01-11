import axios from 'axios'

/**
 * Fetch data from the bucket URL
 * @param path The path to the JSON file (e.g., 'phrases.json')
 * @returns The parsed data or null on error
 */
export async function fetchBucketData<T>(path: string): Promise<T | null> {
  try {
    const { data } = await axios.get<T>(process.env.BUCKET_URL + path)
    return data
  } catch (error) {
    console.error(`Error fetching bucket data from ${path}:`, error)
    return null
  }
}

/**
 * Get a random item from a bucket array
 * @param path The path to the JSON file containing an array
 * @returns A random item from the array or null on error
 */
export async function getRandomBucketItem<T>(path: string): Promise<T | null> {
  const items = await fetchBucketData<T[]>(path)
  if (!items || items.length === 0) {
    return null
  }
  return items[Math.floor(Math.random() * items.length)]
}

/**
 * Get the full bucket URL for a resource
 * @param path The relative path to the resource
 * @returns The full URL
 */
export function getBucketUrl(path: string): string {
  return process.env.BUCKET_URL + path
}
