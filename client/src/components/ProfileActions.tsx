import { useState, useEffect } from 'react';
import { useAppSelector } from '../hooks/useAppSelector';
import type { Profile } from '../store/slices/profilesSlice';
import { io, Socket } from 'socket.io-client';

interface ProcessingState {
  status: 'idle' | 'processing' | 'stopped';
  progress: number;
  total: number;
  current: number;
}

const ProfileActions = ({ profile }: { profile: Profile }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [chatState, setChatState] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    total: 0,
    current: 0
  });
  const [mailState, setMailState] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    total: 0,
    current: 0
  });

  const { token, alphaDateToken, operatorId } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (!token) return;

    const newSocket = io('/', {
      auth: {
        token
      }
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    newSocket.on('chatProgress', (data: ProcessingState) => {
      setChatState(data);
    });

    newSocket.on('mailProgress', (data: ProcessingState) => {
      setMailState(data);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token]);

  const handleStartChat = () => {
    if (!socket || !alphaDateToken) return;

    socket.emit('startProcessing', {
      type: 'chat',
      profileId: profile.external_id,
      alphaDateToken
    });
  };

  const handleStopChat = () => {
    if (!socket) return;

    socket.emit('stopProcessing', {
      type: 'chat',
      profileId: profile.external_id
    });
  };

  const handleStartProcessing = () => {
    socket?.emit('startProcessing', {
      type: 'mail',
      profileId: profile.external_id,
      operatorId
    });
  };

  const handleStopProcessing = () => {
    socket?.emit('stopProcessing', {
      type: 'mail',
      profileId: profile.external_id
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="border rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">Chat Processing</h3>
        <div className="mb-2">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full"
              style={{ width: `${chatState.progress}%` }}
            ></div>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {chatState.status === 'processing'
              ? `Processing ${chatState.current} of ${chatState.total} messages`
              : chatState.status === 'stopped'
              ? 'Processing stopped'
              : 'Ready to process'}
          </p>
        </div>
        <div className="space-x-2">
          <button
            onClick={handleStartChat}
            disabled={chatState.status === 'processing'}
            className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Start Chat Processing
          </button>
          <button
            onClick={handleStopChat}
            disabled={chatState.status !== 'processing'}
            className="bg-red-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="border rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">Mail Processing</h3>
        <div className="mb-2">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-green-600 h-2.5 rounded-full"
              style={{ width: `${mailState.progress}%` }}
            ></div>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {mailState.status === 'processing'
              ? `Processing ${mailState.current} of ${mailState.total} mails`
              : mailState.status === 'stopped'
              ? 'Processing stopped'
              : 'Ready to process'}
          </p>
        </div>
        <div className="space-x-2">
          <button
            onClick={handleStartProcessing}
            disabled={mailState.status === 'processing'}
            className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Start Mail Processing
          </button>
          <button
            onClick={handleStopProcessing}
            disabled={mailState.status !== 'processing'}
            className="bg-red-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileActions; 