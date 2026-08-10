import { getChatGPTUser } from "./chatgpt-auth";
import EnglishHub from "./EnglishHub";

export default async function Home() {
  const user = await getChatGPTUser();
  return <EnglishHub displayName={user?.displayName ?? "Scott"} />;
}
