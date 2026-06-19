require('dotenv').config();
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET (' + process.env.OPENAI_API_KEY.substring(0, 10) + '...)' : 'NOT SET');
console.log('MISTRAL_API_KEY:', process.env.MISTRAL_API_KEY ? 'SET (' + process.env.MISTRAL_API_KEY.substring(0, 10) + '...)' : 'NOT SET');
