# Alpha Date Chance Sender

A fullstack application for managing and automating interactions with Alpha Date profiles. The application features a React frontend with WebSocket support for real-time updates and a Node.js/Express backend with Socket.IO for handling chat and mail processing.

## Features

- User authentication via Alpha Date API
- Profile management and viewing
- Real-time chat message processing
- Real-time mail processing
- Progress tracking for both chat and mail operations
- Modern UI with Tailwind CSS

## Tech Stack

### Frontend
- React
- Redux Toolkit for state management
- Socket.IO Client for real-time updates
- Tailwind CSS for styling
- TypeScript for type safety

### Backend
- Node.js
- Express
- Socket.IO for WebSocket support
- JWT for authentication
- TypeScript for type safety

## Project Structure

```
.
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── pages/        # Page components
│   │   ├── store/        # Redux store and slices
│   │   └── App.tsx       # Main App component
│   └── package.json
│
├── server/                # Backend Express application
│   ├── src/
│   │   ├── middleware/   # Express middleware
│   │   ├── routes/       # API routes
│   │   ├── socket.ts     # Socket.IO handlers
│   │   └── index.ts      # Main server file
│   └── package.json
│
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Alpha Date API credentials

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/alpha-date-sender.git
   cd alpha-date-sender
   ```

2. Install dependencies for both client and server:
   ```bash
   # Install client dependencies
   cd client
   npm install

   # Install server dependencies
   cd ../server
   npm install
   ```

3. Create environment files:
   - Create `.env` in the server directory with the following variables:
     ```
     PORT=3001
     JWT_SECRET=your_jwt_secret
     ALPHA_DATE_API_URL=your_alpha_date_api_url
     ```
   - Create `.env` in the client directory with the following variables:
     ```
     VITE_API_URL=http://localhost:3001
     ```

4. Start the development servers:
   ```bash
   # Start the backend server
   cd server
   npm run dev

   # Start the frontend development server
   cd ../client
   npm run dev
   ```

## Usage

1. Open your browser and navigate to `http://localhost:5173`
2. Log in using your Alpha Date credentials
3. Browse and select profiles from the dashboard
4. Use the chat and mail processing features to automate interactions

## API Endpoints

### Authentication
- `POST /api/auth/login` - Authenticate user and get JWT token

### Profiles
- `GET /api/profiles` - Get all profiles
- `GET /api/profiles/:profileId/attachments` - Get profile attachments

### WebSocket Events
- `startProcessing` - Start processing chat or mail messages
- `stopProcessing` - Stop processing
- `chatProgress` - Chat processing progress updates
- `mailProgress` - Mail processing progress updates

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 