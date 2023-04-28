import { useRouter } from 'next/router';
import useAuth from '../hooks/useAuth';
import FileUpload from '../components/FileUpload';
import STLViewer from '../components/STLViewer';
import { storage } from '../firebaseConfig';

const Profile = () => {
  const router = useRouter();
  const user = useAuth();

  if (!user) {
    router.push('/login');
    return null;
  }

  const uid = user.uid;

  const [urls, setUrls] = useState([]);

  useEffect(() => {
    const storageRef = storage.ref(`users/${uid}`);
    storageRef.listAll().then((res) => {
      const promises = res.items.map((item) => item.getDownloadURL());
      Promise.all(promises).then((urls) => {
        setUrls(urls);
      });
    });
  }, [uid]);

  return (
    <div>
      <h1>Profile</h1>
      <FileUpload uid={uid} />
      {urls.map((url) => (
        <STLViewer key={url} url={url} />
      ))}
    </div>
  );
};

export default Profile;