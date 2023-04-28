import { useState } from 'react';
import { storage } from '../firebaseConfig';

const FileUpload = ({ uid }) => {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const selectedFile = e.target.files[0];

    if (selectedFile && selectedFile.type === 'application/sla') {
      setFile(selectedFile);
      setError(null);
    } else {
      setFile(null);
      setError('Please select an STL file.');
    }
  };

  const handleUpload = () => {
    if (file) {
      const storageRef = storage.ref();
      const fileRef = storageRef.child(`users/${uid}/${file.name}`);
      fileRef.put(file).then(() => {
        console.log('File uploaded successfully!');
      }).catch((error) => {
        console.error(error);
      });
    }
  };

  return (
    <div>
      <input type="file" onChange={handleChange} />
      <button onClick={handleUpload}>Upload</button>
      {error && <p>{error}</p>}
    </div>
  );
};

export default FileUpload;