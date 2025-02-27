// From https://platform.openai.com/docs/api-reference/images/create
// To use this tool, you must pass in a configured OpenAIApi object.
const OpenAI = require('openai');
// const { genAzureEndpoint } = require('~/utils/genAzureEndpoints');
const { v4: uuidv4 } = require('uuid');
const { Tool } = require('langchain/tools');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { getImageBasename } = require('~/server/services/Files/images');
const { processFileURL } = require('~/server/services/Files/process');
const extractBaseURL = require('~/utils/extractBaseURL');
const { logger } = require('~/config');

const { DALLE_REVERSE_PROXY, PROXY } = process.env;
class OpenAICreateImage extends Tool {
  constructor(fields = {}) {
    super();

    this.userId = fields.userId;
    this.fileStrategy = fields.fileStrategy;
    let apiKey = fields.DALLE_API_KEY || this.getApiKey();

    const config = { apiKey };
    if (DALLE_REVERSE_PROXY) {
      config.baseURL = extractBaseURL(DALLE_REVERSE_PROXY);
    }

    if (PROXY) {
      config.httpAgent = new HttpsProxyAgent(PROXY);
    }
    // let azureKey = fields.AZURE_API_KEY || process.env.AZURE_API_KEY;

    // if (azureKey) {
    //   apiKey = azureKey;
    //   const azureConfig = {
    //     apiKey,
    //     azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME || fields.azureOpenAIApiInstanceName,
    //     azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || fields.azureOpenAIApiDeploymentName,
    //     azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || fields.azureOpenAIApiVersion
    //   };
    //   config = {
    //     apiKey,
    //     basePath: genAzureEndpoint({
    //       ...azureConfig,
    //     }),
    //     baseOptions: {
    //       headers: { 'api-key': apiKey },
    //       params: {
    //         'api-version': azureConfig.azureOpenAIApiVersion // this might change. I got the current value from the sample code at https://oai.azure.com/portal/chat
    //       }
    //     }
    //   };
    // }
    this.openai = new OpenAI(config);
    this.name = 'dall-e';
    this.description = `You can generate images with 'dall-e'. This tool is exclusively for visual content.
Guidelines:
- Visually describe the moods, details, structures, styles, and/or proportions of the image. Remember, the focus is on visual attributes.
- Craft your input by "showing" and not "telling" the imagery. Think in terms of what you'd want to see in a photograph or a painting.
- It's best to follow this format for image creation. Come up with the optional inputs yourself if none are given:
"Subject: [subject], Style: [style], Color: [color], Details: [details], Emotion: [emotion]"
- Generate images only once per human query unless explicitly requested by the user`;
  }

  getApiKey() {
    const apiKey = process.env.DALLE_API_KEY || '';
    if (!apiKey) {
      throw new Error('Missing DALLE_API_KEY environment variable.');
    }
    return apiKey;
  }

  replaceUnwantedChars(inputString) {
    return inputString
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/"/g, '')
      .trim();
  }

  wrapInMarkdown(imageUrl) {
    return `![generated image](${imageUrl})`;
  }

  async _call(input) {
    const resp = await this.openai.images.generate({
      prompt: this.replaceUnwantedChars(input),
      // TODO: Future idea -- could we ask an LLM to extract these arguments from an input that might contain them?
      n: 1,
      // size: '1024x1024'
      size: '512x512',
    });

    const theImageUrl = resp.data[0].url;

    if (!theImageUrl) {
      throw new Error('No image URL returned from OpenAI API.');
    }

    const imageBasename = getImageBasename(theImageUrl);
    let imageName = `image_${uuidv4()}.png`;

    if (imageBasename) {
      imageName = imageBasename;
      logger.debug('[DALL-E]', { imageName }); // Output: img-lgCf7ppcbhqQrz6a5ear6FOb.png
    } else {
      logger.debug('[DALL-E] No image name found in the string.', {
        theImageUrl,
        data: resp.data[0],
      });
    }

    try {
      const result = await processFileURL({
        fileStrategy: this.fileStrategy,
        userId: this.userId,
        URL: theImageUrl,
        fileName: imageName,
        basePath: 'images',
      });

      this.result = this.wrapInMarkdown(result);
    } catch (error) {
      logger.error('Error while saving the image:', error);
      this.result = `Failed to save the image locally. ${error.message}`;
    }

    return this.result;
  }
}

module.exports = OpenAICreateImage;
