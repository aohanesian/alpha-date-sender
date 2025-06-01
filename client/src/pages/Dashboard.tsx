import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { useAppDispatch } from '../hooks/useAppDispatch';
import { setProfiles, setLoading, setError } from '../store/slices/profilesSlice';
import { useProfiles } from '../hooks/useProfiles';
import { toast } from 'react-hot-toast';
import { MusicalNoteIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';

const CHAT_MIN_LENGTH = 1;
const CHAT_MAX_LENGTH = 300;
const MAIL_MIN_LENGTH = 150;
const MAIL_MAX_LENGTH = 5000;
const MAIL_MAX_ATTACHMENTS = 5;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

interface ProcessingStatus {
  isProcessing: boolean;
  isPending: boolean;
  status: string;
  messageCount: number;
  deviceId?: string;
  isOwnDevice?: boolean;
  operatorId?: string;
}

interface Attachment {
  id: number;
  user_id: number;
  external_id: string;
  content_type: string;
  link: string;
  filename: string;
  sort_order: number;
  status: number;
  folder: number;
  date_created: string;
  resized_video: number;
  thumb_link: string | null;
}

interface Attachments {
  images: Attachment[];
  videos: Attachment[];
  audios: Attachment[];
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { profiles, loading, error } = useProfiles();
  const { user } = useAuth();
  const [chatMessages, setChatMessages] = useState<{ [key: string]: string }>({});
  const [mailMessages, setMailMessages] = useState<{ [key: string]: string }>({});
  const [processingChat, setProcessingChat] = useState<{ [key: string]: ProcessingStatus }>({});
  const [processingMail, setProcessingMail] = useState<{ [key: string]: ProcessingStatus }>({});
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const socketRef = useRef<Socket | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const [refreshingAttachments, setRefreshingAttachments] = useState<Record<string, boolean>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachments>>({});
  const [selectedAttachments, setSelectedAttachments] = useState<Record<string, Set<number>>>({});
  const profilesArray = Array.isArray(profiles) ? profiles : [];

  console.log('Dashboard component loaded with auth state:', {
    hasToken: !!user?.token,
    hasAlphaDateToken: !!user?.alphaDateToken,
    hasOperatorId: !!user?.operatorId,
    operatorId: user?.operatorId
  });

  useEffect(() => {
    if (!user?.token || !user?.alphaDateToken) {
      console.log('Missing required tokens:', { 
        hasToken: !!user?.token, 
        hasAlphaDateToken: !!user?.alphaDateToken 
      });
      navigate('/login');
      return;
    }

    // Cleanup existing socket connection
    if (socketRef.current) {
      console.log('Cleaning up existing socket connection...');
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    console.log('Initializing socket connection with token:', user.token);
    // Initialize socket connection
    const newSocket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: {
        token: user.token,
        operatorId: user.operatorId
      },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      forceNew: true
    });

    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      console.log('Socket connected successfully:', {
        id: newSocket.id,
        connected: newSocket.connected,
        hasToken: !!user?.token,
        operatorId: user?.operatorId
      });
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.socket;
        return newErrors;
      });
    });

    newSocket.on('deviceRegistered', (data) => {
      console.log('Device registered:', data);
      deviceIdRef.current = data.deviceId;
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', {
        error: error.message,
        name: error.name,
        token: user.token ? 'present' : 'missing',
        operatorId: user.operatorId
      });
      setValidationErrors(prev => ({
        ...prev,
        socket: 'Failed to connect to server'
      }));
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', {
        reason,
        wasConnected: newSocket.connected
      });
      if (reason === 'io server disconnect') {
        console.log('Attempting to reconnect...');
        newSocket.connect();
      }
    });

    newSocket.on('error', (error) => {
      console.error('Socket error received:', {
        message: error.message,
        type: error.type
      });
      setValidationErrors(prev => ({
        ...prev,
        socket: error.message || 'Socket error occurred'
      }));
    });

    // Multi-device event handlers
    newSocket.on('processingStarted', (data) => {
      console.log('Processing started on another device:', data);
      const { profileId, type, deviceId } = data;
      const isOwnDevice = deviceId === deviceIdRef.current;
      
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: true,
            isPending: false,
            status: isOwnDevice ? '🔄 Processing...' : '🔄 Processing started on another device...',
            messageCount: 0,
            deviceId,
            isOwnDevice
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: true,
            isPending: false,
            status: isOwnDevice ? '🔄 Processing...' : '🔄 Processing started on another device...',
            messageCount: 0,
            deviceId,
            isOwnDevice
          }
        }));
      }
    });

    newSocket.on('processingProgress', (data) => {
      console.log('Processing progress from another device:', data);
      const { profileId, type, progress, deviceId } = data;
      const isOwnDevice = deviceId === deviceIdRef.current;
      
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            isProcessing: true,
            isPending: false,
            status: progress.message,
            messageCount: progress.current,
            deviceId,
            isOwnDevice
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            isProcessing: true,
            isPending: false,
            status: progress.message,
            messageCount: progress.current,
            deviceId,
            isOwnDevice
          }
        }));
      }
    });

    newSocket.on('processingComplete', (data) => {
      console.log('Processing completed on another device:', data);
      const { profileId, type, stats } = data;
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: false,
            status: `✅ Completed on another device (${stats?.current || 0}/${stats?.total || 0})`,
            messageCount: stats?.current || 0
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: false,
            status: `✅ Completed on another device (${stats?.current || 0}/${stats?.total || 0})`,
            messageCount: stats?.current || 0
          }
        }));
      }
    });

    newSocket.on('processingStopped', (data) => {
      console.log('Processing stopped event received:', data);
      const { profileId, type, deviceId, stoppedBy } = data;
      const isOwnDevice = deviceId === deviceIdRef.current || stoppedBy === deviceIdRef.current;

      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            isProcessing: false,
            isPending: false,
            status: isOwnDevice ? '⏹️ Processing stopped' : '⏹️ Stopped on another device',
            messageCount: prev[profileId]?.messageCount || 0,
            deviceId: deviceId || stoppedBy,
            isOwnDevice
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            isProcessing: false,
            isPending: false,
            status: isOwnDevice ? '⏹️ Processing stopped' : '⏹️ Stopped on another device',
            messageCount: prev[profileId]?.messageCount || 0,
            deviceId: deviceId || stoppedBy,
            isOwnDevice
          }
        }));
      }
    });

    newSocket.on('processingInterrupted', (data) => {
      console.log('Processing interrupted:', data);
      const { profileId, type, reason } = data;
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: false,
            status: `⚠️ Interrupted: ${reason}`,
            messageCount: prev[profileId]?.messageCount || 0
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: false,
            status: `⚠️ Interrupted: ${reason}`,
            messageCount: prev[profileId]?.messageCount || 0
          }
        }));
      }
    });

    newSocket.on('processingStateSync', (data) => {
      console.log('Processing state sync:', data);
      const { profileId, type, isProcessing, current, total, deviceId, isOwnDevice } = data;
      
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            isProcessing,
            status: isProcessing 
              ? `${isOwnDevice ? '🔄' : '📱'} Processing... (${current}/${total})`
              : 'Ready',
            messageCount: current,
            deviceId,
            isOwnDevice
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            isProcessing,
            status: isProcessing 
              ? `${isOwnDevice ? '🔄' : '📱'} Processing... (${current}/${total})`
              : 'Ready',
            messageCount: current,
            deviceId,
            isOwnDevice
          }
        }));
      }
    });

    // Message synchronization event handlers
    newSocket.on('messageSync', (data) => {
      console.log('Message sync received:', data);
      const { profileId, type, message } = data;
      if (type === 'chat') {
        setChatMessages(prev => ({
          ...prev,
          [profileId]: message
        }));
      } else {
        setMailMessages(prev => ({
          ...prev,
          [profileId]: message
        }));
      }
    });

    newSocket.on('messageUpdated', (data) => {
      console.log('Message updated from another device:', data);
      const { profileId, type, message, deviceId } = data;
      // Only update if it's from another device
      if (deviceId !== newSocket.id) {
        if (type === 'chat') {
          setChatMessages(prev => ({
            ...prev,
            [profileId]: message
          }));
        } else {
          setMailMessages(prev => ({
            ...prev,
            [profileId]: message
          }));
        }
      }
    });

    newSocket.on('messageCleared', (data) => {
      console.log('Message cleared from another device:', data);
      const { profileId, type, deviceId } = data;
      // Only update if it's from another device
      if (deviceId !== newSocket.id) {
        if (type === 'chat') {
          setChatMessages(prev => ({
            ...prev,
            [profileId]: ''
          }));
        } else {
          setMailMessages(prev => ({
            ...prev,
            [profileId]: ''
          }));
        }
      }
    });

    newSocket.on('blocklistCleared', (data) => {
      console.log('Blocklist cleared:', data);
      const { profileId, type, message } = data;
      toast.success(`${message} for ${type} on profile ${profileId}`);
    });

    newSocket.on('progress', (data) => {
      console.log('Progress update received:', {
        profileId: data.profileId,
        type: data.type,
        progress: data.progress,
        deviceId: data.deviceId
      });
      const { profileId, type, progress, deviceId } = data;
      const isOwnDevice = deviceId === deviceIdRef.current;
      
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            isProcessing: true,
            isPending: false,
            status: isOwnDevice ? `🔄 Processing... (${progress.current}/${progress.total})` : `📱 Processing on another device... (${progress.current}/${progress.total})`,
            messageCount: progress.current,
            deviceId,
            isOwnDevice
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            isProcessing: true,
            isPending: false,
            status: isOwnDevice ? `🔄 Processing... (${progress.current}/${progress.total})` : `📱 Processing on another device... (${progress.current}/${progress.total})`,
            messageCount: progress.current,
            deviceId,
            isOwnDevice
          }
        }));
      }
    });

    newSocket.on('processingComplete', (data) => {
      console.log('Processing complete event received:', {
        profileId: data.profileId,
        type: data.type
      });
      const { profileId, type } = data;
      if (type === 'chat') {
        setProcessingChat(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: false,
            status: 'Processing completed',
            messageCount: prev[profileId]?.messageCount || 0
          }
        }));
      } else {
        setProcessingMail(prev => ({
          ...prev,
          [profileId]: {
            isProcessing: false,
            status: 'Processing completed',
            messageCount: prev[profileId]?.messageCount || 0
          }
        }));
      }
    });

    return () => {
      console.log('Cleaning up socket connection...');
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      deviceIdRef.current = null;
    };
  }, [user?.token, user?.operatorId]);

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!user?.alphaDateToken) {
        console.log('No Alpha Date token available, redirecting to login');
        navigate('/login');
        return;
      }

      try {
        console.log('Fetching profiles with Alpha Date token:', {
          hasAlphaDateToken: !!user.alphaDateToken,
          operatorId: user.operatorId
        });

        const response = await fetch(`${API_URL}/api/profiles`, {
          headers: {
            'X-Alpha-Date-Token': user.alphaDateToken,
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        });

        if (!response.ok) {
          if (response.status === 401) {
            console.log('Unauthorized, redirecting to login');
            navigate('/login');
            return;
          }
          throw new Error('Failed to fetch profiles');
        }

        const data = await response.json();
        console.log('Profiles response:', data);
        dispatch(setProfiles(data));

      } catch (err) {
        console.error('Error fetching profiles:', err);
        dispatch(setError(err instanceof Error ? err.message : 'Failed to fetch profiles'));
      } finally {
        dispatch(setLoading(false));
      }
    };

    fetchProfiles();
  }, [navigate, dispatch, user?.alphaDateToken]);

  const validateMessage = (type: 'chat' | 'mail', message: string, profileId: string): boolean => {
    const minLength = type === 'chat' ? CHAT_MIN_LENGTH : MAIL_MIN_LENGTH;
    const maxLength = type === 'chat' ? CHAT_MAX_LENGTH : MAIL_MAX_LENGTH;
    const errorKey = `${type}-validation-${profileId}`;

    if (message.length < minLength) {
      setValidationErrors(prev => ({
        ...prev,
        [errorKey]: `${type === 'chat' ? 'Chat' : 'Mail'} message must be at least ${minLength} character${minLength === 1 ? '' : 's'} long`
      }));
      return false;
    }

    if (message.length > maxLength) {
      setValidationErrors(prev => ({
        ...prev,
        [errorKey]: `${type === 'chat' ? 'Chat' : 'Mail'} message must not exceed ${maxLength} characters`
      }));
      return false;
    }

    setValidationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[errorKey];
      return newErrors;
    });
    return true;
  };

  const handleChatMessageChange = (profileId: string, message: string) => {
    setChatMessages(prev => ({
      ...prev,
      [profileId]: message
    }));
    validateMessage('chat', message, profileId);
    
    // Emit message update to other devices
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('updateMessage', {
        profileId,
        type: 'chat',
        message
      });
    }
  };

  const handleMailMessageChange = (profileId: string, message: string) => {
    setMailMessages(prev => ({
      ...prev,
      [profileId]: message
    }));
    validateMessage('mail', message, profileId);
    
    // Emit message update to other devices
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('updateMessage', {
        profileId,
        type: 'mail',
        message
      });
    }
  };

  const handleClearMailMessage = (profileId: string) => {
    setMailMessages(prev => ({
      ...prev,
      [profileId]: ''
    }));
    setValidationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[`mail-validation-${profileId}`];
      return newErrors;
    });
    
    // Emit message clear to other devices
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('clearMessage', {
        profileId,
        type: 'mail'
      });
    }
  };

  const handleStartChatProcessing = (profileId: string) => {
    console.log('handleStartChatProcessing called with:', {
      profileId,
      hasSocket: !!socketRef.current,
      socketConnected: socketRef.current?.connected,
      hasAlphaDateToken: !!user?.alphaDateToken,
      hasMessage: !!chatMessages[profileId],
      message: chatMessages[profileId],
      operatorId: user?.operatorId,
      deviceId: deviceIdRef.current
    });

    if (!socketRef.current || !user?.alphaDateToken) {
      console.log('Early return: missing socket or alphaDateToken');
      return;
    }

    const message = chatMessages[profileId];
    if (!message) {
      console.log('Early return: no message');
      toast.error('Please enter a message first');
      return;
    }

    // Validate message length
    if (!validateMessage('chat', message, profileId)) {
      return;
    }

    // Set pending state immediately
    setProcessingChat(prev => ({
      ...prev,
      [profileId]: {
        isProcessing: false,
        isPending: true,
        status: '⏳ Pending...',
        messageCount: 0,
        deviceId: deviceIdRef.current || undefined,
        isOwnDevice: true
      }
    }));

    console.log('About to emit startProcessing event with payload:', {
      type: 'chat',
      profileId: profileId,
      message,
      operatorId: user?.operatorId,
      deviceId: deviceIdRef.current
    });

    socketRef.current.emit('startProcessing', {
      type: 'chat',
      profileId: profileId,
      message,
      operatorId: user?.operatorId,
      deviceId: deviceIdRef.current
    });

    console.log('startProcessing event emitted successfully');
  };

  const handleStopChatProcessing = (profileId: string) => {
    if (!socketRef.current) return;

    console.log('Stopping chat processing:', {
      profileId,
      deviceId: deviceIdRef.current,
      operatorId: user?.operatorId
    });

    socketRef.current.emit('stopProcessing', {
      type: 'chat',
      profileId: profileId,
      operatorId: user?.operatorId
    });
  };

  const handleStartMailProcessing = (profileId: string) => {
    if (!socketRef.current || !user?.alphaDateToken) return;

    const message = mailMessages[profileId];
    if (!message) {
      toast.error('Please enter a message first');
      return;
    }

    // Validate message length
    if (!validateMessage('mail', message, profileId)) {
      return;
    }

    // Get selected attachments for this profile
    const selectedIds = selectedAttachments[profileId] || new Set();
    
    // Validate attachment count
    if (selectedIds.size > MAIL_MAX_ATTACHMENTS) {
      toast.error(`You can only select up to ${MAIL_MAX_ATTACHMENTS} attachments`);
      return;
    }
    
    const profileAttachments = attachments[profileId];
    
    // Transform selected attachments into the required format
    const attachmentsPayload = Array.from(selectedIds).map(attachmentId => {
      // Find the attachment in our data
      const attachment = [
        ...(profileAttachments?.images || []),
        ...(profileAttachments?.videos || []),
        ...(profileAttachments?.audios || [])
      ].find(a => a.id === attachmentId);

      if (!attachment) return null;

      // Map to the required format based on content type
      if (attachment.content_type === 'image') {
        return {
          title: attachment.filename,
          link: attachment.link,
          message_type: "SENT_IMAGE"
        };
      } else if (attachment.content_type === 'video') {
        return {
          title: attachment.filename,
          link: attachment.link,
          message_type: "SENT_VIDEO",
          id: attachment.id
        };
      } else if (attachment.content_type === 'audio') {
        return {
          title: attachment.filename,
          link: attachment.link,
          message_type: "SENT_AUDIO"
        };
      }
      return null;
    }).filter(Boolean);

    // Set pending state immediately
    setProcessingMail(prev => ({
      ...prev,
      [profileId]: {
        isProcessing: false,
        isPending: true,
        status: '⏳ Pending...',
        messageCount: 0,
        deviceId: deviceIdRef.current || undefined,
        isOwnDevice: true
      }
    }));

    // Send the message and attachments
    socketRef.current.emit('startProcessing', {
      type: 'mail',
      profileId: profileId,
      message,
      operatorId: user?.operatorId,
      attachments: attachmentsPayload
    });
  };

  const handleStopMailProcessing = (profileId: string) => {
    if (!socketRef.current) return;

    console.log('Stopping mail processing:', {
      profileId,
      deviceId: deviceIdRef.current,
      operatorId: user?.operatorId
    });

    socketRef.current.emit('stopProcessing', {
      type: 'mail',
      profileId: profileId,
      operatorId: user?.operatorId
    });
  };

  const handleClearChatBlocklist = (profileId: string) => {
    if (!socketRef.current) return;

    socketRef.current.emit('clearBlocklist', {
      profileId,
      type: 'chat'
    });
  };

  const handleClearMailBlocklist = (profileId: string) => {
    if (!socketRef.current) return;

    socketRef.current.emit('clearBlocklist', {
      profileId,
      type: 'mail'
    });
  };

  const handleLogout = () => {
    navigate('/login');
  };

  const handleRefreshAttachments = async (profileId: string) => {
    if (!user?.alphaDateToken) {
      toast.error('Not authenticated');
      return;
    }

    try {
      setRefreshingAttachments(prev => ({ ...prev, [profileId]: true }));
      const response = await fetch(`${API_URL}/api/profiles/${profileId}/attachments`, {
        headers: {
          'X-Alpha-Date-Token': user.alphaDateToken
        }
      });

      if (!response.ok) {
        throw new Error('Failed to refresh attachments');
      }

      const data = await response.json();
      console.log('Attachments refreshed:', data);
      
      setAttachments(prev => ({
        ...prev,
        [profileId]: data
      }));

      toast.success('Attachments refreshed successfully');
    } catch (error) {
      console.error('Error refreshing attachments:', error);
      toast.error('Failed to refresh attachments');
    } finally {
      setRefreshingAttachments(prev => ({ ...prev, [profileId]: false }));
    }
  };

  const handleAttachmentSelect = (profileId: string, attachmentId: number) => {
    setSelectedAttachments(prev => {
      const current = prev[profileId] || new Set();
      const newSet = new Set(current);
      
      if (newSet.has(attachmentId)) {
        newSet.delete(attachmentId);
      } else {
        // Check if we're already at the max limit
        if (newSet.size >= MAIL_MAX_ATTACHMENTS) {
          toast.error(`You can only select up to ${MAIL_MAX_ATTACHMENTS} attachments`);
          return prev;
        }
        newSet.add(attachmentId);
      }
      
      return {
        ...prev,
        [profileId]: newSet
      };
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <div className="text-xl text-gray-700 dark:text-gray-300">Loading profiles...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="text-xl text-red-600 dark:text-red-400">Error: {error}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (profilesArray.length === 0) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center space-y-4">
        <div className="text-xl text-gray-700 dark:text-gray-300">No profiles found</div>
        <button
          onClick={handleLogout}
          className="bg-pink-500 text-white px-4 py-2 rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-2 gap-4">
          {/* Chat Column */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Chat Messages</h2>
            {profilesArray.map((profile) => (
              <div
                key={`chat-${profile.external_id}`}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm"
              >
                <div className="flex items-start space-x-4">
                  <img
                    src={profile.photo_link}
                    alt={profile.name}
                    className="w-24 h-24 object-cover rounded-lg"
                  />
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{profile.name}, {profile.age}</h2>
                    <p className="text-gray-600 dark:text-gray-400">ID: {profile.external_id}</p>
                    <p className="text-gray-600 dark:text-gray-400">Location: {profile.country_name}</p>
                    <div className="mt-4">
                      <textarea
                        value={chatMessages[profile.external_id] || ''}
                        onChange={(e) => handleChatMessageChange(profile.external_id, e.target.value)}
                        placeholder="Type your chat message here..."
                        disabled={processingChat[profile.external_id]?.isProcessing || processingChat[profile.external_id]?.isPending}
                        className="w-full h-24 p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        <span className={
                          (chatMessages[profile.external_id] || '').length < CHAT_MIN_LENGTH || 
                          (chatMessages[profile.external_id] || '').length > CHAT_MAX_LENGTH 
                            ? 'text-red-500' 
                            : ''
                        }>
                          {(chatMessages[profile.external_id] || '').length}
                        </span>
                        /{CHAT_MAX_LENGTH} characters (min: {CHAT_MIN_LENGTH})
                      </div>
                      {validationErrors[`chat-validation-${profile.external_id}`] && (
                        <div className="mt-1 text-sm text-red-500">
                          {validationErrors[`chat-validation-${profile.external_id}`]}
                        </div>
                      )}
                      <div className="mt-2 flex space-x-2">
                        {!processingChat[profile.external_id]?.isProcessing && !processingChat[profile.external_id]?.isPending ? (
                          <button
                            onClick={() => handleStartChatProcessing(profile.external_id)}
                            disabled={
                              !chatMessages[profile.external_id] ||
                              chatMessages[profile.external_id].length < CHAT_MIN_LENGTH ||
                              chatMessages[profile.external_id].length > CHAT_MAX_LENGTH
                            }
                            className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600"
                          >
                            Start Chat
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStopChatProcessing(profile.external_id)}
                            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
                          >
                            {processingChat[profile.external_id]?.isPending ? 'Pending...' : 'Stop Chat'}
                          </button>
                        )}
                        <button
                          onClick={() => handleClearChatBlocklist(profile.external_id)}
                          className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                        >
                          Clear Blocklist
                        </button>
                      </div>
                      {processingChat[profile.external_id] && (
                        <div className="text-sm text-blue-600 dark:text-blue-400 mt-2 whitespace-pre-line">
                          {processingChat[profile.external_id].status}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Mail Column */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Mail Messages</h2>
            {profilesArray.map((profile) => (
              <div
                key={`mail-${profile.external_id}`}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm"
              >
                <div className="flex items-start space-x-4">
                  <img
                    src={profile.photo_link}
                    alt={profile.name}
                    className="w-24 h-24 object-cover rounded-lg"
                  />
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{profile.name}, {profile.age}</h2>
                    <p className="text-gray-600 dark:text-gray-400">ID: {profile.external_id}</p>
                    <p className="text-gray-600 dark:text-gray-400">Location: {profile.country_name}</p>
                    <div className="mt-4">
                      <textarea
                        value={mailMessages[profile.external_id] || ''}
                        onChange={(e) => handleMailMessageChange(profile.external_id, e.target.value)}
                        placeholder="Type your mail message here..."
                        disabled={processingMail[profile.external_id]?.isProcessing || processingMail[profile.external_id]?.isPending}
                        className="w-full h-24 p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        <span className={
                          (mailMessages[profile.external_id] || '').length < MAIL_MIN_LENGTH || 
                          (mailMessages[profile.external_id] || '').length > MAIL_MAX_LENGTH 
                            ? 'text-red-500' 
                            : ''
                        }>
                          {(mailMessages[profile.external_id] || '').length}
                        </span>
                        /{MAIL_MAX_LENGTH} characters (min: {MAIL_MIN_LENGTH})
                      </div>
                      {validationErrors[`mail-validation-${profile.external_id}`] && (
                        <div className="mt-1 text-sm text-red-500">
                          {validationErrors[`mail-validation-${profile.external_id}`]}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => handleRefreshAttachments(profile.external_id)}
                          disabled={refreshingAttachments[profile.external_id]}
                          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {refreshingAttachments[profile.external_id] ? 'Refreshing...' : 'Refresh Attachments'}
                        </button>
                      </div>
                      <div className="mt-2">
                        {attachments[profile.external_id] ? (
                          Object.entries(attachments[profile.external_id]).some(([_, items]) => items.length > 0) ? (
                            <>
                              <div className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                                Selected attachments: 
                                <span className={
                                  (selectedAttachments[profile.external_id]?.size || 0) > MAIL_MAX_ATTACHMENTS
                                    ? 'text-red-500 font-semibold'
                                    : 'font-semibold'
                                }>
                                  {' '}{selectedAttachments[profile.external_id]?.size || 0}/{MAIL_MAX_ATTACHMENTS}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(attachments[profile.external_id]).map(([type, items]) => (
                                  items.map((item: Attachment) => (
                                    <div key={item.id} className="relative group">
                                      <div className="w-24 h-24 relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900">
                                        {type === 'images' && (
                                          <img
                                            src={item.link}
                                            alt={item.filename}
                                            className="w-full h-full object-cover"
                                          />
                                        )}
                                        {type === 'videos' && (
                                          <div className="relative w-full h-full">
                                            <img
                                              src={item.thumb_link || item.link}
                                              alt={item.filename}
                                              className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                                              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                                              </svg>
                                            </div>
                                          </div>
                                        )}
                                        {type === 'audios' && (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <MusicalNoteIcon className="w-8 h-8 text-gray-400" />
                                          </div>
                                        )}
                                        <div className="absolute top-1 right-1">
                                          <input
                                            type="checkbox"
                                            checked={selectedAttachments[profile.external_id]?.has(item.id) || false}
                                            onChange={() => handleAttachmentSelect(profile.external_id, item.id)}
                                            disabled={processingMail[profile.external_id]?.isProcessing || processingMail[profile.external_id]?.isPending}
                                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                          />
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate">
                                          {type.slice(0, -1)}
                                        </div>
                                      </div>
                                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate max-w-24">
                                        {item.filename}
                                      </div>
                                    </div>
                                  ))
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              Add attachments to "send" folder and click Refresh
                            </div>
                          )
                        ) : (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            Add attachments to "send" folder and click Refresh
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex space-x-2">
                        {!processingMail[profile.external_id]?.isProcessing && !processingMail[profile.external_id]?.isPending ? (
                          <button
                            onClick={() => handleStartMailProcessing(profile.external_id)}
                            disabled={
                              !mailMessages[profile.external_id] ||
                              mailMessages[profile.external_id].length < MAIL_MIN_LENGTH ||
                              mailMessages[profile.external_id].length > MAIL_MAX_LENGTH ||
                              (selectedAttachments[profile.external_id]?.size || 0) > MAIL_MAX_ATTACHMENTS
                            }
                            className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-600"
                          >
                            Start Mail
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStopMailProcessing(profile.external_id)}
                            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
                          >
                            {processingMail[profile.external_id]?.isPending ? 'Pending...' : 'Stop Mail'}
                          </button>
                        )}
                        <button
                          onClick={() => handleClearMailBlocklist(profile.external_id)}
                          className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                        >
                          Clear Blocklist
                        </button>
                        <button
                          onClick={() => handleClearMailMessage(profile.external_id)}
                          className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                        >
                          Clear Message
                        </button>
                      </div>
                      {processingMail[profile.external_id] && (
                        <div className="text-sm text-blue-600 dark:text-blue-400 mt-2 whitespace-pre-line">
                          {processingMail[profile.external_id].status}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard; 